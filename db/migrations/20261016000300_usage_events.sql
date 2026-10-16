-- Coach OS — mesure d'usage minimale (roadmap P0.4).
--
-- Savoir ce qui est réellement utilisé pendant le pilote, sans outil tiers ni donnée personnelle : une ligne = « il s'est passé X dans
-- ce club » (club, événement, instant). AUCUN identifiant de personne ni de séance. Écrite par des déclencheurs sur les tables
-- existantes, donc tous les chemins (application, tâches planifiées) sont couverts sans toucher aux fonctions métier.
-- Lisible par les administrateurs du club (comme le journal d'audit) ; conservée 13 mois (purge_usage_events).

create table public.usage_events (
  id bigint generated always as identity primary key,
  academy_id uuid not null references public.academies (id) on delete cascade,
  event text not null check (event in ('checkin_qr', 'booking_created', 'roll_validated', 'roll_auto_closed')),
  created_at timestamptz not null default now()
);
create index usage_events_academy_idx on public.usage_events (academy_id, created_at desc);
create index usage_events_created_idx on public.usage_events (created_at);

alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;
create policy usage_events_select on public.usage_events for select to authenticated
  using (app_private.is_admin(academy_id));
revoke all on public.usage_events from public, anon, authenticated;
grant select on public.usage_events to authenticated;

create function app_private.usage_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_event text;
begin
  if tg_table_name = 'attendance' then
    if new.source = 'qr' then v_event := 'checkin_qr'; end if;
  elsif tg_table_name = 'session_bookings' then
    if new.status = 'booked' and not new.is_instructor then v_event := 'booking_created'; end if;
  elsif tg_table_name = 'session_checkins' then
    if new.validated_at is not null and (tg_op = 'INSERT' or old.validated_at is null) then
      v_event := case when new.validated_auto then 'roll_auto_closed' else 'roll_validated' end;
    end if;
  end if;
  if v_event is not null then
    insert into public.usage_events (academy_id, event) values (new.academy_id, v_event);
  end if;
  return null;
end
$$;
revoke all on function app_private.usage_record() from public;

create trigger attendance_usage after insert on public.attendance
  for each row execute function app_private.usage_record();
create trigger session_bookings_usage after insert on public.session_bookings
  for each row execute function app_private.usage_record();
create trigger session_checkins_usage after insert or update of validated_at on public.session_checkins
  for each row execute function app_private.usage_record();

create function app_private.purge_usage_events() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  delete from public.usage_events where created_at < now() - interval '13 months';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app_private.purge_usage_events() from public, anon, authenticated;
grant execute on function app_private.purge_usage_events() to app_server;
