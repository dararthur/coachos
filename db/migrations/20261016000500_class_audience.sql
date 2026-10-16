-- Coach OS — public des types de cours et âge minimum pour les cours adultes (roadmap P1.6).
--
-- Chaque type de cours a un public : 'all' (par défaut, rien ne change), 'adults' ou 'kids'. Règles, appliquées par la base à la
-- réservation (adhérent, mineur avec compte, parent pour son enfant) :
--   * 'kids'   : réservé aux mineurs ; un majeur est refusé ;
--   * 'adults' : réservé aux personnes d'au moins `academies.adult_class_min_age` ans (18 par défaut = adultes seulement). Un club
--                qui accueille les ados dans ses cours adultes abaisse ce seuil (10 à 18 ans) dans ses réglages (administrateur).
-- L'âge vient de people.birth_date, conservée seulement pour un mineur ; sans date de naissance, la personne est majeure.
-- Une réservation DÉJÀ prise n'est jamais annulée par un changement de réglage. Le staff qui inscrit manuellement n'est pas concerné.

alter table public.class_types
  add column audience text not null default 'all' check (audience in ('all', 'adults', 'kids'));
grant insert (audience), update (audience) on public.class_types to authenticated;

alter table public.academies
  add column adult_class_min_age smallint not null default 18 check (adult_class_min_age between 10 and 18);
grant update (adult_class_min_age) on public.academies to authenticated;

-- Le journal d'audit des réglages du club signale aussi ce seuil.
create or replace function app_private.audit_academy_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.write_audit(
    new.id, (select auth.uid()), 'academy.settings_updated', 'academy', new.id,
    jsonb_build_object(
      'name_changed', old.name is distinct from new.name,
      'timezone_changed', old.timezone is distinct from new.timezone,
      'currency_changed', old.currency is distinct from new.currency,
      'retention_changed', old.retention_months is distinct from new.retention_months,
      'adult_class_min_age_changed', old.adult_class_min_age is distinct from new.adult_class_min_age
    )
  );
  return new;
end
$$;

drop trigger academies_audit_update on public.academies;
create trigger academies_audit_update after update on public.academies
  for each row when (
    old.name is distinct from new.name or old.timezone is distinct from new.timezone
    or old.currency is distinct from new.currency or old.retention_months is distinct from new.retention_months
    or old.adult_class_min_age is distinct from new.adult_class_min_age
  )
  execute function app_private.audit_academy_update();

-- Cœur de la règle (pur) : la personne peut-elle suivre ce public ?
create function app_private.audience_allows(p_audience text, p_min_age integer, p_birth date) returns boolean
language sql stable set search_path = '' as $$
  select case p_audience
    when 'adults' then p_birth is null or date_part('year', age(current_date, p_birth)) >= p_min_age
    when 'kids' then app_private.is_minor(p_birth)
    else true
  end
$$;
revoke all on function app_private.audience_allows(text, integer, date) from public;

-- Réservation : même corps qu'avant, avec le contrôle du public après le retour anticipé d'une réservation existante.
create or replace function app_private.book_person(p_session uuid, p_person uuid) returns text
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
  if not exists (
    select 1
    from public.class_types ct
    join public.academies a on a.id = ct.academy_id
    join public.people p on p.id = p_person and p.academy_id = a.id
    where ct.id = v_session.class_type_id and ct.academy_id = v_session.academy_id
      and app_private.audience_allows(ct.audience, a.adult_class_min_age, p.birth_date)
  ) then
    raise exception 'coachos:audience_not_allowed' using errcode = 'P0001';
  end if;

  select count(*) into v_booked from public.session_bookings where session_id = p_session and status = 'booked';
  v_status := case when v_session.capacity is null or v_booked < v_session.capacity then 'booked' else 'waitlisted' end;
  insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at)
  values (v_session.academy_id, p_session, p_person, v_status, case when v_status = 'booked' then now() end);
  return v_status;
end
$$;

-- Listes : une colonne « public refusé à l'appelant » (null = accès permis) pour masquer le bouton « Réserver ».
drop function public.session_bookings_overview(uuid, timestamptz, timestamptz);
create function public.session_bookings_overview(p_academy uuid, p_from timestamptz, p_to timestamptz)
returns table (session_id uuid, booked integer, waitlisted integer, my_status text, my_position integer, denied_audience text)
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
  with mine as (select p.id, p.birth_date from public.people p where p.academy_id = p_academy and p.user_id = v_uid),
  ranked as (
    select b.session_id, b.person_id, b.status,
      (case when b.status = 'waitlisted' then row_number() over (partition by b.session_id, b.status order by b.seq) end)::integer as pos
    from public.session_bookings b
    join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
    where b.academy_id = p_academy and s.starts_at >= p_from and s.starts_at < p_to
  )
  select s.id,
    (count(r.session_id) filter (where r.status = 'booked'))::integer,
    (count(r.session_id) filter (where r.status = 'waitlisted'))::integer,
    max(r.status) filter (where r.person_id in (select id from mine)),
    max(r.pos) filter (where r.person_id in (select id from mine)),
    (select case when ct.audience <> 'all' and exists (select 1 from mine m where not app_private.audience_allows(ct.audience, a.adult_class_min_age, m.birth_date))
                 then ct.audience end
     from public.class_types ct join public.academies a on a.id = ct.academy_id
     where ct.id = s.class_type_id and ct.academy_id = s.academy_id)
  from public.sessions s
  left join ranked r on r.session_id = s.id
  where s.academy_id = p_academy and s.starts_at >= p_from and s.starts_at < p_to
  group by s.id, s.class_type_id, s.academy_id;
end
$$;
revoke all on function public.session_bookings_overview(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.session_bookings_overview(uuid, timestamptz, timestamptz) to authenticated;

drop function public.child_sessions(uuid);
create function public.child_sessions(p_child uuid)
returns table (session_id uuid, class_name text, starts_at timestamptz, ends_at timestamptz, capacity integer, timezone text,
               booked integer, waitlisted integer, child_status text, child_position integer, denied_audience text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_academy uuid := app_private.guardian_child_academy(p_child);
  v_birth date;
begin
  select birth_date into v_birth from public.people where id = p_child;
  return query
  with ranked as (
    select b.session_id, b.person_id, b.status,
      (case when b.status = 'waitlisted' then row_number() over (partition by b.session_id, b.status order by b.seq) end)::integer as pos
    from public.session_bookings b
    join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
    where b.academy_id = v_academy and s.ends_at > now() and s.starts_at < now() + interval '14 days'
  )
  select s.id, ct.name, s.starts_at, s.ends_at, s.capacity, a.timezone,
    (count(r.session_id) filter (where r.status = 'booked'))::integer,
    (count(r.session_id) filter (where r.status = 'waitlisted'))::integer,
    max(r.status) filter (where r.person_id = p_child),
    max(r.pos) filter (where r.person_id = p_child),
    case when not app_private.audience_allows(ct.audience, a.adult_class_min_age, v_birth) then ct.audience end
  from public.sessions s
  join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
  join public.academies a on a.id = s.academy_id
  left join ranked r on r.session_id = s.id
  where s.academy_id = v_academy and s.status = 'scheduled' and s.ends_at > now() and s.starts_at < now() + interval '14 days'
  group by s.id, ct.name, ct.audience, a.timezone, a.adult_class_min_age
  order by s.starts_at;
end
$$;
revoke all on function public.child_sessions(uuid) from public, anon;
grant execute on function public.child_sessions(uuid) to authenticated;
