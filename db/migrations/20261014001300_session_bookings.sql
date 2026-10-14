-- Coach OS — 0013 réservation des séances par les membres, liste d'attente et lien avec le pointage.
--
-- Règles métier :
--   * un membre réserve une séance à venir ; la réservation est OBLIGATOIRE pour pointer (QR) ;
--   * la capacité ne bloque jamais : au-delà, la réservation passe en liste d'attente (ordre d'arrivée) ;
--     une place qui se libère (annulation, capacité augmentée) est attribuée automatiquement au premier de la liste ;
--   * la réservation s'annule tant que la feuille d'appel n'est pas validée par le coach et que la présence n'est pas enregistrée ;
--   * à la validation de la feuille, une réservation confirmée sans présence devient une ABSENCE ;
--   * le coach voit les inscrits avant le cours (feuille d'appel, planning, tableau de bord) et peut faire passer un membre
--     de la liste d'attente à « inscrit » même au-delà de la capacité.
-- Aucun accès direct en écriture : tout passe par les fonctions ci-dessous (verrou de la séance, capacité arbitrée en base).

create table public.session_bookings (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  session_id uuid not null,
  person_id uuid not null,
  status text not null check (status in ('booked', 'waitlisted')),
  -- Ordre d'arrivée : sert à départager la liste d'attente.
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (session_id, person_id),
  foreign key (session_id, academy_id) references public.sessions (id, academy_id) on delete cascade,
  foreign key (person_id, academy_id) references public.people (id, academy_id) on delete cascade
);
create index session_bookings_person_idx on public.session_bookings (academy_id, person_id);
create index session_bookings_session_idx on public.session_bookings (session_id, status, seq);

alter table public.session_bookings enable row level security;
-- Le staff voit toutes les réservations de son club ; un membre voit les siennes.
create policy session_bookings_select on public.session_bookings for select to authenticated
  using (
    app_private.is_staff(academy_id)
    or exists (
      select 1 from public.people p
      where p.id = session_bookings.person_id and p.academy_id = session_bookings.academy_id and p.user_id = (select auth.uid())
    )
  );
revoke all on public.session_bookings from anon, authenticated, public;
grant select on public.session_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Aides internes
-- ---------------------------------------------------------------------------
-- Attribue les places libres aux premiers de la liste d'attente (sans plafond si la séance n'a pas de capacité).
create function app_private.promote_waitlist(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cap integer;
  v_free integer;
begin
  select capacity into v_cap from public.sessions where id = p_session;
  if v_cap is null then
    v_free := 1000000;
  else
    v_free := greatest(v_cap - (select count(*) from public.session_bookings where session_id = p_session and status = 'booked'), 0);
  end if;
  update public.session_bookings set status = 'booked', confirmed_at = now()
  where id in (
    select id from public.session_bookings where session_id = p_session and status = 'waitlisted' order by seq limit v_free
  );
end
$$;
revoke all on function app_private.promote_waitlist(uuid) from public;

-- Réserve pour une fiche (déjà authentifiée par l'appelant). Idempotent : une réservation existante est retournée telle quelle.
create function app_private.book_person(p_session uuid, p_person uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_status text;
  v_booked integer;
begin
  select * into v_session from public.sessions where id = p_session for update;
  if v_session.id is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  select status into v_status from public.session_bookings where session_id = p_session and person_id = p_person;
  if v_status is not null then
    return v_status;
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'coachos:session_cancelled' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.session_checkins where session_id = p_session and validated_at is not null) then
    raise exception 'coachos:roll_validated' using errcode = 'P0001';
  end if;
  if now() >= v_session.ends_at then
    raise exception 'coachos:booking_closed' using errcode = 'P0001';
  end if;

  select count(*) into v_booked from public.session_bookings where session_id = p_session and status = 'booked';
  v_status := case when v_session.capacity is null or v_booked < v_session.capacity then 'booked' else 'waitlisted' end;
  insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at)
  values (v_session.academy_id, p_session, p_person, v_status, case when v_status = 'booked' then now() end);
  return v_status;
end
$$;
revoke all on function app_private.book_person(uuid, uuid) from public;

-- La fiche active du compte connecté dans le club de la séance.
create function app_private.my_person_for_session(p_session uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  v_person uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.sessions where id = p_session;
  if v_academy is null or not app_private.is_member(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  select id into v_person from public.people
  where academy_id = v_academy and user_id = v_uid and archived_at is null and anonymized_at is null;
  if v_person is null then
    raise exception 'coachos:booking_no_profile' using errcode = 'P0001';
  end if;
  return v_person;
end
$$;
revoke all on function app_private.my_person_for_session(uuid) from public;

-- ---------------------------------------------------------------------------
-- Membre : réserver, annuler, voir l'occupation
-- ---------------------------------------------------------------------------
create function public.book_session(p_session uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  return app_private.book_person(p_session, app_private.my_person_for_session(p_session));
end
$$;

create function public.cancel_booking(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := app_private.my_person_for_session(p_session);
  v_status text;
begin
  perform 1 from public.sessions where id = p_session for update;
  if exists (select 1 from public.session_checkins where session_id = p_session and validated_at is not null) then
    raise exception 'coachos:roll_validated' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.attendance where session_id = p_session and person_id = v_person and status in ('present', 'late')) then
    raise exception 'coachos:booking_attended' using errcode = 'P0001';
  end if;
  delete from public.session_bookings where session_id = p_session and person_id = v_person returning status into v_status;
  if v_status = 'booked' then
    perform app_private.promote_waitlist(p_session);
  end if;
end
$$;

-- Occupation des séances d'une période (tout membre du club) + réservation de l'appelant.
create function public.session_bookings_overview(p_academy uuid, p_from timestamptz, p_to timestamptz)
returns table (session_id uuid, booked integer, waitlisted integer, my_status text, my_position integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_member(p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  return query
  with mine as (select p.id from public.people p where p.academy_id = p_academy and p.user_id = v_uid),
  ranked as (
    select b.session_id, b.person_id, b.status,
      (case when b.status = 'waitlisted' then row_number() over (partition by b.session_id, b.status order by b.seq) end)::integer as pos
    from public.session_bookings b
    join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
    where b.academy_id = p_academy and s.starts_at >= p_from and s.starts_at < p_to
  )
  select r.session_id,
    (count(*) filter (where r.status = 'booked'))::integer,
    (count(*) filter (where r.status = 'waitlisted'))::integer,
    max(r.status) filter (where r.person_id in (select id from mine)),
    max(r.pos) filter (where r.person_id in (select id from mine))
  from ranked r
  group by r.session_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Coach : faire passer un membre de la liste d'attente à « inscrit » (au-delà de la capacité si besoin)
-- ---------------------------------------------------------------------------
create function public.promote_booking(p_session uuid, p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.sessions where id = p_session;
  if v_academy is null or not app_private.is_member(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if not app_private.can_record_attendance(p_session) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  update public.session_bookings set status = 'booked', confirmed_at = now()
  where session_id = p_session and person_id = p_person and status = 'waitlisted';
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  perform app_private.write_audit(v_academy, v_uid, 'booking.promoted', 'session', p_session, '{}'::jsonb);
end
$$;

-- Une augmentation de capacité libère des places : la liste d'attente avance toute seule.
create function app_private.sessions_capacity_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.promote_waitlist(new.id);
  return new;
end
$$;
revoke all on function app_private.sessions_capacity_changed() from public;
create trigger sessions_promote_waitlist after update of capacity on public.sessions
  for each row when (new.capacity is distinct from old.capacity) execute function app_private.sessions_capacity_changed();

-- Un membre archivé ou anonymisé n'occupe plus de place : ses réservations sont retirées et la liste avance.
create function app_private.people_drop_bookings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in delete from public.session_bookings where person_id = new.id and academy_id = new.academy_id returning session_id, status loop
    if r.status = 'booked' then
      perform app_private.promote_waitlist(r.session_id);
    end if;
  end loop;
  return new;
end
$$;
revoke all on function app_private.people_drop_bookings() from public;
create trigger people_drop_bookings after update of archived_at, anonymized_at on public.people
  for each row when ((new.archived_at is not null and old.archived_at is null) or (new.anonymized_at is not null and old.anonymized_at is null))
  execute function app_private.people_drop_bookings();

-- ---------------------------------------------------------------------------
-- Validation de la feuille : une réservation confirmée sans présence devient une absence
-- ---------------------------------------------------------------------------
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
    select b.academy_id, b.session_id, b.person_id, 'absent'
    from public.session_bookings b
    join public.people p on p.id = b.person_id and p.academy_id = b.academy_id and p.archived_at is null and p.anonymized_at is null
    where b.session_id = p_session and b.status = 'booked'
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

-- ---------------------------------------------------------------------------
-- Pointage : la réservation est obligatoire
-- ---------------------------------------------------------------------------
create or replace function public.checkin_peek(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_status text;
  v_booking text;
  v_tz text;
begin
  select * into r from app_private.checkin_resolve(p_token_hash, false);
  select a.timezone into v_tz from public.academies a where a.id = r.academy_id;
  select a.status into v_status from public.attendance a where a.session_id = r.session_id and a.person_id = r.person_id;
  select b.status into v_booking from public.session_bookings b where b.session_id = r.session_id and b.person_id = r.person_id;
  return jsonb_build_object(
    'class_name', r.class_name, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'timezone', v_tz,
    'already_recorded', v_status is not null, 'status', v_status, 'booking', v_booking
  );
end
$$;

-- Pointage proprement dit, pour une fiche dont la réservation est confirmée. Une présence déjà enregistrée n'est jamais écrasée.
create function app_private.checkin_record(p_academy uuid, p_session uuid, p_person uuid, p_class_name text, p_starts_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status text;
begin
  insert into public.attendance (academy_id, session_id, person_id, status, source)
  values (p_academy, p_session, p_person, 'present', 'qr')
  on conflict (session_id, person_id) do nothing
  returning id into v_id;
  if v_id is null then
    select a.status into v_status from public.attendance a where a.session_id = p_session and a.person_id = p_person;
    return jsonb_build_object('result', 'already', 'status', v_status, 'class_name', p_class_name, 'starts_at', p_starts_at);
  end if;
  return jsonb_build_object('result', 'recorded', 'status', 'present', 'class_name', p_class_name, 'starts_at', p_starts_at);
end
$$;
revoke all on function app_private.checkin_record(uuid, uuid, uuid, text, timestamptz) from public;

create or replace function public.checkin_redeem(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_booking text;
begin
  select * into r from app_private.checkin_resolve(p_token_hash, true);
  select b.status into v_booking from public.session_bookings b where b.session_id = r.session_id and b.person_id = r.person_id;
  if v_booking is null then
    -- Une présence déjà enregistrée (coach ou pointage antérieur) reste lisible même sans réservation.
    if exists (select 1 from public.attendance a where a.session_id = r.session_id and a.person_id = r.person_id) then
      return app_private.checkin_record(r.academy_id, r.session_id, r.person_id, r.class_name, r.starts_at);
    end if;
    raise exception 'coachos:checkin_no_booking' using errcode = 'P0001';
  end if;
  if v_booking = 'waitlisted' then
    raise exception 'coachos:checkin_waitlisted' using errcode = 'P0001';
  end if;
  return app_private.checkin_record(r.academy_id, r.session_id, r.person_id, r.class_name, r.starts_at);
end
$$;

-- Réserve puis pointe en un geste (le membre n'avait pas réservé) ; si la séance est pleine, il reste en liste d'attente (result = 'waitlisted').
create function public.checkin_book_and_redeem(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_booking text;
begin
  select * into r from app_private.checkin_resolve(p_token_hash, true);
  v_booking := app_private.book_person(r.session_id, r.person_id);
  if v_booking = 'waitlisted' then
    -- Pas d'exception : la mise en liste d'attente doit être conservée.
    return jsonb_build_object('result', 'waitlisted', 'class_name', r.class_name, 'starts_at', r.starts_at);
  end if;
  return app_private.checkin_record(r.academy_id, r.session_id, r.person_id, r.class_name, r.starts_at);
end
$$;

-- ---------------------------------------------------------------------------
-- Export RGPD : grade, silhouette, consentement et réservations en plus (0009, 0010, 0011, 0013)
-- ---------------------------------------------------------------------------
create or replace function public.export_person_data(p_person uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.people where id = p_person;
  if v_academy is null or not app_private.is_admin(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'academy', (select a.name from public.academies a where a.id = v_academy),
    'person', jsonb_build_object(
      'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
      'belt', p.belt, 'belt_stripes', p.belt_stripes, 'avatar_style', p.avatar_style, 'ranking_opt_in', p.ranking_opt_in,
      'joined_on', p.joined_on, 'external_ref', p.external_ref,
      'adult_attested_at', p.adult_attested_at, 'archived_at', p.archived_at, 'created_at', p.created_at
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', at.status, 'recorded_at', at.recorded_at
      ) order by s.starts_at)
      from public.attendance at
      join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where at.person_id = p.id and at.academy_id = p.academy_id
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', b.status, 'booked_at', b.created_at
      ) order by s.starts_at)
      from public.session_bookings b
      join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where b.person_id = p.id and b.academy_id = p.academy_id
    ), '[]'::jsonb)
  ) into v_result
  from public.people p where p.id = p_person;

  perform app_private.write_audit(v_academy, v_uid, 'member.data_exported', 'person', p_person, '{}'::jsonb);
  return v_result;
end
$$;

create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  perform app_private.write_audit(null, v_uid, 'account.data_exported', 'user', v_uid, '{}'::jsonb);
  return jsonb_build_object(
    'generated_at', now(),
    'profile', (select jsonb_build_object('email', p.email, 'display_name', p.display_name, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'academies', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'role', m.role, 'since', m.created_at))
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    'member_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
        'belt', p.belt, 'belt_stripes', p.belt_stripes, 'avatar_style', p.avatar_style, 'ranking_opt_in', p.ranking_opt_in,
        'joined_on', p.joined_on,
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb),
        'bookings', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', b.status) order by s.starts_at)
          from public.session_bookings b join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
          where b.person_id = p.id and b.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.people p join public.academies a on a.id = p.academy_id
      where p.user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Privilèges
-- ---------------------------------------------------------------------------
revoke all on function public.book_session(uuid), public.cancel_booking(uuid), public.promote_booking(uuid, uuid),
  public.session_bookings_overview(uuid, timestamptz, timestamptz), public.checkin_book_and_redeem(text) from public, anon;
grant execute on function public.book_session(uuid), public.cancel_booking(uuid), public.promote_booking(uuid, uuid),
  public.session_bookings_overview(uuid, timestamptz, timestamptz), public.checkin_book_and_redeem(text) to authenticated;
