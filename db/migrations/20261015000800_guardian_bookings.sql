-- Coach OS — 0028 le responsable légal réserve les cours de son enfant.
--
-- Un mineur sans compte ne peut pas réserver lui-même. Son responsable légal rattaché (guardianships.guardian_user_id), après
-- confirmation de son accord et tant qu'il n'est pas retiré, voit les prochains cours du club de l'enfant, réserve et annule pour lui.
-- Mêmes règles que pour un adhérent (capacité, liste d'attente, feuille d'appel validée) : on réutilise app_private.book_person.
-- Limite connue : l'e-mail « votre place est confirmée » (0022) n'existe que pour une fiche avec compte ; pour un enfant sans compte,
-- le responsable voit le statut dans l'application mais n'est pas prévenu par e-mail d'une promotion depuis la liste d'attente.

-- Le club de l'enfant si l'appelant est son responsable lié, avec accord confirmé et fiche active.
create function app_private.guardian_child_academy(p_child uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child and guardian_user_id = v_uid;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_g.consent_confirmed_at is null or v_g.consent_withdrawn_at is not null then
    raise exception 'coachos:consent_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.people where id = p_child and academy_id = v_g.academy_id and archived_at is null and anonymized_at is null) then
    raise exception 'coachos:booking_no_profile' using errcode = 'P0001';
  end if;
  return v_g.academy_id;
end
$$;
revoke all on function app_private.guardian_child_academy(uuid) from public;

-- Prochains cours (14 jours) du club de l'enfant, avec l'occupation et la réservation DE L'ENFANT.
create function public.child_sessions(p_child uuid)
returns table (session_id uuid, class_name text, starts_at timestamptz, ends_at timestamptz, capacity integer, timezone text,
               booked integer, waitlisted integer, child_status text, child_position integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_academy uuid := app_private.guardian_child_academy(p_child);
begin
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
    max(r.pos) filter (where r.person_id = p_child)
  from public.sessions s
  join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
  join public.academies a on a.id = s.academy_id
  left join ranked r on r.session_id = s.id
  where s.academy_id = v_academy and s.status = 'scheduled' and s.ends_at > now() and s.starts_at < now() + interval '14 days'
  group by s.id, ct.name, a.timezone
  order by s.starts_at;
end
$$;

create function public.book_for_child(p_session uuid, p_child uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid := app_private.guardian_child_academy(p_child);
begin
  if not exists (select 1 from public.sessions where id = p_session and academy_id = v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  return app_private.book_person(p_session, p_child);
end
$$;

create function public.cancel_child_booking(p_session uuid, p_child uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid := app_private.guardian_child_academy(p_child);
  v_status text;
begin
  perform 1 from public.sessions where id = p_session and academy_id = v_academy for update;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.session_checkins where session_id = p_session and validated_at is not null) then
    raise exception 'coachos:roll_validated' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.attendance where session_id = p_session and person_id = p_child and status in ('present', 'late')) then
    raise exception 'coachos:booking_attended' using errcode = 'P0001';
  end if;
  delete from public.session_bookings where session_id = p_session and person_id = p_child returning status into v_status;
  if v_status = 'booked' then
    perform app_private.promote_waitlist(p_session);
  end if;
end
$$;

revoke all on function public.child_sessions(uuid), public.book_for_child(uuid, uuid), public.cancel_child_booking(uuid, uuid) from public, anon;
grant execute on function public.child_sessions(uuid), public.book_for_child(uuid, uuid), public.cancel_child_booking(uuid, uuid) to authenticated;
