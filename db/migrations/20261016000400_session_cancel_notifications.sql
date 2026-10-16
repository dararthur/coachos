-- Coach OS — « séance annulée » et « place confirmée » en e-mail ET en notification push (roadmap P1.4).
--
-- On réutilise la file de la migration 0022 (booking_notifications : bail de 10 minutes, 5 tentatives, SKIP LOCKED) en y ajoutant un
-- TYPE : 'promoted' (place attribuée depuis la liste d'attente, comme avant) ou 'cancelled' (la séance réservée est annulée).
-- Annuler une séance met en file, dans la même transaction, une ligne par réservation confirmée d'un adhérent ayant un compte
-- (jamais le coach affecté, inscrit d'office). Rien ne part si la séance est déjà commencée, si elle est réactivée avant l'envoi,
-- si la réservation a été annulée, ou si la fiche est archivée ou anonymisée : la ligne est alors supprimée sans envoi.
-- Les appareils de l'adhérent sont lus au moment de l'envoi (app_private.push_targets_for_user), jamais copiés dans la file.

alter table public.booking_notifications add column kind text not null default 'promoted' check (kind in ('promoted', 'cancelled'));
alter table public.booking_notifications drop constraint booking_notifications_booking_id_key;
alter table public.booking_notifications add constraint booking_notifications_booking_kind_key unique (booking_id, kind);

-- Promotion : même déclencheur qu'avant, avec le type explicite.
create or replace function app_private.session_bookings_queue_promotion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.people p
    where p.id = new.person_id and p.academy_id = new.academy_id and p.user_id is not null
  ) then
    insert into public.booking_notifications (academy_id, booking_id, kind) values (new.academy_id, new.id, 'promoted')
    on conflict (booking_id, kind) do nothing;
  end if;
  return null;
end
$$;

-- Annulation d'une séance à venir : une ligne par réservation confirmée.
create function app_private.sessions_queue_cancellation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at > now() then
    insert into public.booking_notifications (academy_id, booking_id, kind)
    select b.academy_id, b.id, 'cancelled'
    from public.session_bookings b
    join public.people p on p.id = b.person_id and p.academy_id = b.academy_id and p.user_id is not null
      and p.archived_at is null and p.anonymized_at is null
    where b.session_id = new.id and b.academy_id = new.academy_id and b.status = 'booked' and not b.is_instructor
    on conflict (booking_id, kind) do nothing;
  end if;
  return null;
end
$$;
revoke all on function app_private.sessions_queue_cancellation() from public;
create trigger sessions_queue_cancellation after update of status on public.sessions
  for each row when (old.status = 'scheduled' and new.status = 'cancelled')
  execute function app_private.sessions_queue_cancellation();

-- Envoi : la signature change (type et compte du destinataire), on remplace la fonction.
drop function app_private.claim_booking_notifications(integer);
create function app_private.claim_booking_notifications(p_limit integer)
returns table (notification_id uuid, academy_id uuid, kind text, user_id uuid, email text, academy_name text, class_name text, starts_at timestamptz, timezone text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
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
           and b.status = 'booked' and s.starts_at > now()
           and s.status = case n.kind when 'cancelled' then 'cancelled' else 'scheduled' end
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
    returning n.id, n.booking_id, n.academy_id, n.kind
  )
  select c.id, c.academy_id, c.kind, p.user_id, u.email, a.name, ct.name, s.starts_at, a.timezone
  from claimed c
  join public.session_bookings b on b.id = c.booking_id and b.academy_id = c.academy_id
  join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
  join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
  join public.academies a on a.id = c.academy_id
  join public.people p on p.id = b.person_id and p.academy_id = b.academy_id
  join auth.users u on u.id = p.user_id;
end
$$;
revoke all on function app_private.claim_booking_notifications(integer) from public, anon, authenticated;
grant execute on function app_private.claim_booking_notifications(integer) to app_server;

-- Appareils d'un adhérent, pour un club dont il est membre (jamais ceux d'un autre compte).
create function app_private.push_targets_for_user(p_user uuid, p_academy uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql security definer stable set search_path = '' as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.academy_memberships m on m.user_id = s.user_id and m.academy_id = p_academy
  where s.user_id = p_user
$$;
revoke all on function app_private.push_targets_for_user(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.push_targets_for_user(uuid, uuid) to app_server;
