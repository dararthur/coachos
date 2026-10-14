-- Coach OS — 0019 mode membre pour l'équipe et coach d'office inscrit à ses séances.
--
--   * Un compte de l'équipe (propriétaire, administrateur, coach) peut avoir sa propre fiche d'adhérent (ensure_my_member_record)
--     et réserver d'autres séances comme n'importe quel membre (mode « membre » de l'interface).
--   * Le coach affecté à une séance y est inscrit d'office : sa fiche est créée au besoin et une réservation « confirmée » est posée,
--     sans jamais passer en liste d'attente (le coach anime la séance, il ne prend pas la place d'un adhérent). Changer de coach retire
--     la réservation d'office de l'ancien (tant qu'il n'a pas de présence enregistrée).

alter table public.session_bookings add column is_instructor boolean not null default false;

-- Fiche d'adhérent du compte connecté (idempotent) : réservé aux comptes rattachés au club.
create function public.ensure_my_member_record(p_academy uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_member(p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  return app_private.ensure_member_record(p_academy, v_uid);
end
$$;
revoke all on function public.ensure_my_member_record(uuid) from public, anon;
grant execute on function public.ensure_my_member_record(uuid) to authenticated;

-- Inscription d'office du coach affecté.
create function app_private.enroll_instructor(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_person uuid;
begin
  select * into v_session from public.sessions where id = p_session;
  if v_session.id is null then
    return;
  end if;
  -- L'ancien coach perd sa réservation d'office (sauf présence déjà enregistrée).
  delete from public.session_bookings b
  where b.session_id = p_session and b.is_instructor
    and b.person_id not in (select p.id from public.people p where p.academy_id = v_session.academy_id and p.user_id is not distinct from v_session.instructor_id)
    and not exists (select 1 from public.attendance a where a.session_id = b.session_id and a.person_id = b.person_id);
  if v_session.instructor_id is null or v_session.status <> 'scheduled' then
    return;
  end if;
  v_person := app_private.ensure_member_record(v_session.academy_id, v_session.instructor_id);
  insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at, is_instructor)
  values (v_session.academy_id, p_session, v_person, 'booked', now(), true)
  on conflict (session_id, person_id) do nothing;
end
$$;
revoke all on function app_private.enroll_instructor(uuid) from public;

create function app_private.sessions_enroll_instructor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.enroll_instructor(new.id);
  return null;
end
$$;
revoke all on function app_private.sessions_enroll_instructor() from public;

create trigger sessions_enroll_instructor_ins after insert on public.sessions
  for each row when (new.instructor_id is not null) execute function app_private.sessions_enroll_instructor();
create trigger sessions_enroll_instructor_upd after update of instructor_id on public.sessions
  for each row when (new.instructor_id is distinct from old.instructor_id) execute function app_private.sessions_enroll_instructor();

-- Séances à venir déjà planifiées avec un coach.
select app_private.enroll_instructor(s.id)
from public.sessions s
where s.instructor_id is not null and s.status = 'scheduled' and s.ends_at > now();

-- Une fiche créée automatiquement (adhérent ou coach) n'a pas encore attesté la majorité : si son compte disparaît ou quitte le club
-- avant la validation du profil, la fiche est ARCHIVÉE au lieu de bloquer la suppression (contrainte de majorité attestée). La purge de
-- rétention l'anonymise ensuite comme toute fiche archivée.
alter table public.people drop constraint people_adult_attested_check;
alter table public.people add constraint people_adult_attested_check
  check (anonymized_at is not null or adult_attested_at is not null or user_id is not null or archived_at is not null);

create function app_private.people_archive_orphan_stub() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id is null and old.user_id is not null and new.adult_attested_at is null and new.anonymized_at is null then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end
$$;
revoke all on function app_private.people_archive_orphan_stub() from public;
create trigger people_archive_orphan_stub before update of user_id on public.people
  for each row execute function app_private.people_archive_orphan_stub();

-- Validation de la feuille : le coach affecté, inscrit d'office, est PRÉSENT (il a animé la séance) ; les autres réservations confirmées
-- sans présence deviennent des absences, comme avant.
create or replace function public.roll_set_validated(p_session uuid, p_validated boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions := app_private.checkin_authorize(p_session);
  v_no_shows integer := 0;
begin
  if p_validated then
    if v_session.status <> 'scheduled' then
      raise exception 'coachos:session_cancelled' using errcode = 'P0001';
    end if;
    insert into public.session_checkins as c (session_id, academy_id, status, closed_at, validated_at, validated_by)
    values (p_session, v_session.academy_id, 'closed', now(), now(), v_uid)
    on conflict (session_id) do update
      set status = 'closed', closed_at = now(), validated_at = now(), validated_by = v_uid;
    perform app_private.checkin_revoke_tokens(p_session);

    insert into public.attendance (academy_id, session_id, person_id, status)
    select b.academy_id, b.session_id, b.person_id, 'present'
    from public.session_bookings b
    join public.people p on p.id = b.person_id and p.academy_id = b.academy_id and p.archived_at is null and p.anonymized_at is null
    where b.session_id = p_session and b.status = 'booked' and b.is_instructor
    on conflict (session_id, person_id) do nothing;

    insert into public.attendance (academy_id, session_id, person_id, status)
    select b.academy_id, b.session_id, b.person_id, 'absent'
    from public.session_bookings b
    join public.people p on p.id = b.person_id and p.academy_id = b.academy_id and p.archived_at is null and p.anonymized_at is null
    where b.session_id = p_session and b.status = 'booked' and not b.is_instructor
    on conflict (session_id, person_id) do nothing;
    get diagnostics v_no_shows = row_count;

    perform app_private.write_audit(v_session.academy_id, v_uid, 'roll.validated', 'session', p_session,
      jsonb_build_object('no_shows', v_no_shows));
  else
    update public.session_checkins set validated_at = null, validated_by = null where session_id = p_session;
    perform app_private.write_audit(v_session.academy_id, v_uid, 'roll.reopened', 'session', p_session, '{}'::jsonb);
  end if;
  return jsonb_build_object('validated', p_validated, 'no_shows', v_no_shows);
end
$$;
