-- Coach OS — 0022 e-mail à l'adhérent promu depuis la liste d'attente.
--
-- Toute promotion (annulation d'un inscrit, capacité augmentée ou retirée, inscrit archivé ou anonymisé, place accordée par le
-- coach) fait passer une réservation de 'waitlisted' à 'booked'. Un déclencheur sur session_bookings l'inscrit dans une file
-- (booking_notifications) DANS LA MÊME TRANSACTION : une promotion validée a toujours sa ligne, une transaction annulée n'en
-- laisse aucune, et aucun chemin de promotion, présent ou futur, ne peut l'oublier.
--
-- L'application vide la file avec le rôle app_server : juste après l'action qui a pu causer la promotion, et chaque jour par la
-- tâche de purge (filet de sécurité). La file ne contient que des identifiants : le contenu de l'e-mail (adresse du compte, club,
-- cours, date) est lu au moment de l'envoi, ce qui reflète un changement d'horaire et ne recopie l'adresse nulle part.
-- Aucun e-mail : fiche sans compte, compte sans adresse confirmée ou retiré du club, fiche archivée ou anonymisée, réservation
-- annulée, séance annulée ou déjà commencée au moment de l'envoi. La ligne est alors supprimée sans envoi.

-- Cible des clés étrangères composites (id, academy_id), comme les autres tables tenant.
alter table public.session_bookings add constraint session_bookings_id_academy_key unique (id, academy_id);

create table public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  -- Une seule promotion par réservation (aucun chemin ne la repasse en liste d'attente). L'annulation de la réservation
  -- supprime la notification en attente : on ne prévient pas d'une place que l'adhérent a déjà rendue.
  booking_id uuid not null unique,
  created_at timestamptz not null default now(),
  -- Envoi en cours ou échoué : la ligne n'est reprise qu'à l'expiration du bail (10 min), au plus 5 tentatives.
  claimed_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  foreign key (booking_id, academy_id) references public.session_bookings (id, academy_id) on delete cascade
);
create index booking_notifications_academy_idx on public.booking_notifications (academy_id);
create index booking_notifications_created_idx on public.booking_notifications (created_at);

-- Aucune politique et aucun privilège : seules les fonctions SECURITY DEFINER ci-dessous lisent ou écrivent la file.
alter table public.booking_notifications enable row level security;
alter table public.booking_notifications force row level security;
revoke all on public.booking_notifications from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mise en file, dans la transaction de la promotion
-- ---------------------------------------------------------------------------
create function app_private.session_bookings_queue_promotion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Une fiche sans compte n'a pas d'adresse à prévenir : rien n'est mis en file.
  if exists (
    select 1 from public.people p
    where p.id = new.person_id and p.academy_id = new.academy_id and p.user_id is not null
  ) then
    insert into public.booking_notifications (academy_id, booking_id) values (new.academy_id, new.id)
    on conflict (booking_id) do nothing;
  end if;
  return null;
end
$$;
revoke all on function app_private.session_bookings_queue_promotion() from public;
create trigger session_bookings_queue_promotion after update of status on public.session_bookings
  for each row when (old.status = 'waitlisted' and new.status = 'booked')
  execute function app_private.session_bookings_queue_promotion();

-- ---------------------------------------------------------------------------
-- Envoi (rôle app_server uniquement)
-- ---------------------------------------------------------------------------
-- Supprime ce qui ne doit plus partir, puis réserve un lot (verrou SKIP LOCKED + bail : deux envois simultanés ne prennent
-- jamais la même ligne) et renvoie le strict nécessaire à l'e-mail.
create function app_private.claim_booking_notifications(p_limit integer)
returns table (notification_id uuid, academy_id uuid, email text, academy_name text, class_name text, starts_at timestamptz, timezone text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  -- SKIP LOCKED ici aussi : deux nettoyages simultanés ne s'attendent jamais (pas d'interblocage).
  delete from public.booking_notifications d
  where d.id in (
    select n.id from public.booking_notifications n
    where (n.attempts >= 5 and (n.claimed_at is null or n.claimed_at < now() - interval '10 minutes'))
       or not exists (
         select 1
         from public.session_bookings b
         join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
         join public.people p on p.id = b.person_id and p.academy_id = b.academy_id
         join auth.users u on u.id = p.user_id
         join public.academy_memberships m on m.academy_id = b.academy_id and m.user_id = p.user_id
         where b.id = n.booking_id and b.academy_id = n.academy_id
           and b.status = 'booked' and s.status = 'scheduled' and s.starts_at > now()
           and p.archived_at is null and p.anonymized_at is null and u.email_verified
       )
    for update of n skip locked
  );

  return query
  with picked as (
    select n.id from public.booking_notifications n
    where n.attempts < 5 and (n.claimed_at is null or n.claimed_at < now() - interval '10 minutes')
    order by n.created_at
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
    for update skip locked
  ), claimed as (
    update public.booking_notifications n set claimed_at = now(), attempts = n.attempts + 1
    from picked where n.id = picked.id
    returning n.id, n.booking_id, n.academy_id
  )
  select c.id, c.academy_id, u.email, a.name, ct.name, s.starts_at, a.timezone
  from claimed c
  join public.session_bookings b on b.id = c.booking_id and b.academy_id = c.academy_id
  join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
  join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
  join public.academies a on a.id = c.academy_id
  join public.people p on p.id = b.person_id and p.academy_id = b.academy_id
  join auth.users u on u.id = p.user_id;
end
$$;

-- E-mail remis au fournisseur : la ligne disparaît (rien n'est conservé). Un échec n'appelle rien : le bail sert de délai
-- avant la tentative suivante.
create function app_private.complete_booking_notification(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.booking_notifications where id = p_id;
$$;

revoke all on function app_private.claim_booking_notifications(integer), app_private.complete_booking_notification(uuid)
  from public, anon, authenticated;
grant execute on function app_private.claim_booking_notifications(integer), app_private.complete_booking_notification(uuid)
  to app_server;
