-- Coach OS — rappel push « séance dans 1 h, tout est prêt ? » aux adhérents inscrits.
--
-- Une tâche planifiée (toutes les 5 minutes) demande à la base les séances qui commencent dans 35 à 65 minutes et n'ont pas encore
-- été rappelées. La base les marque dans la même instruction (une ligne par séance dans session_reminders : deux appels simultanés
-- ne rappellent jamais deux fois) et renvoie les appareils des adhérents inscrits (réservation « booked », compte rattaché à la
-- fiche, membre du club, fiche ni archivée ni anonymisée). Séance annulée : aucun rappel. Séance déplacée : la marque est effacée,
-- le rappel repart pour le nouvel horaire. Envoi « au mieux » : un rappel manqué n'est pas rejoué (il serait périmé).

create table public.session_reminders (
  session_id uuid primary key,
  academy_id uuid not null references public.academies (id) on delete cascade,
  sent_at timestamptz not null default now(),
  foreign key (session_id, academy_id) references public.sessions (id, academy_id) on delete cascade
);

-- Aucune politique ni privilège : seules les fonctions ci-dessous y accèdent.
alter table public.session_reminders enable row level security;
alter table public.session_reminders force row level security;
revoke all on public.session_reminders from public, anon, authenticated;

create function app_private.session_reminder_reset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.session_reminders where session_id = new.id;
  return null;
end
$$;
revoke all on function app_private.session_reminder_reset() from public;
create trigger sessions_reminder_reset after update of starts_at on public.sessions
  for each row when (old.starts_at is distinct from new.starts_at)
  execute function app_private.session_reminder_reset();

create function app_private.claim_session_reminders()
returns table (session_id uuid, academy_id uuid, academy_name text, class_name text, starts_at timestamptz, timezone text,
               sub_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select s.id, s.academy_id, s.class_type_id, s.starts_at
    from public.sessions s
    where s.status = 'scheduled'
      and s.starts_at > now() + interval '35 minutes' and s.starts_at <= now() + interval '65 minutes'
      and not exists (select 1 from public.session_reminders r where r.session_id = s.id)
  ), marked as (
    insert into public.session_reminders (session_id, academy_id) select d.id, d.academy_id from due d on conflict do nothing returning session_id
  )
  select d.id, d.academy_id, a.name, ct.name, d.starts_at, a.timezone, ps.id, ps.endpoint, ps.p256dh, ps.auth
  from due d
  join marked m on m.session_id = d.id
  join public.academies a on a.id = d.academy_id
  join public.class_types ct on ct.id = d.class_type_id and ct.academy_id = d.academy_id
  join public.session_bookings b on b.session_id = d.id and b.academy_id = d.academy_id and b.status = 'booked'
  join public.people p on p.id = b.person_id and p.academy_id = b.academy_id
    and p.user_id is not null and p.archived_at is null and p.anonymized_at is null
  join public.academy_memberships am on am.academy_id = d.academy_id and am.user_id = p.user_id
  join public.push_subscriptions ps on ps.user_id = p.user_id;
end
$$;
revoke all on function app_private.claim_session_reminders() from public, anon, authenticated;
grant execute on function app_private.claim_session_reminders() to app_server;
