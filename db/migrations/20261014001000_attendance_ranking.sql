-- Coach OS — 0010 classement d'assiduité (semaine / mois / année) et consentement des membres.
--
-- Principe RGPD : le classement NOMINATIF n'est visible des autres membres que pour ceux qui l'ont accepté
-- (people.ranking_opt_in, faux par défaut). Un membre voit toujours sa propre ligne et son rang réel ; le staff voit tout
-- le monde (il a déjà accès aux présences). Le rang d'un membre est calculé sur tous les membres actifs, consentants ou non,
-- sans jamais révéler l'identité des autres.

alter table public.people add column ranking_opt_in boolean not null default false;

-- Un membre anonymisé ne figure plus nulle part.
create or replace function app_private.people_clear_phone_on_anonymize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.anonymized_at is not null then
    new.phone := null;
    new.ranking_opt_in := false;
  end if;
  return new;
end
$$;

-- Choix du membre connecté pour SA fiche dans ce club (aucun privilège direct sur la colonne).
create function public.set_my_ranking_visibility(p_academy uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  update public.people set ranking_opt_in = coalesce(p_visible, false)
  where academy_id = p_academy and user_id = v_uid and anonymized_at is null and archived_at is null;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  perform app_private.write_audit(p_academy, v_uid, 'member.ranking_visibility', 'person', null,
    jsonb_build_object('visible', coalesce(p_visible, false)));
end
$$;

-- Classement sur [p_from, p_to[ (dates locales du club). Venues = présent ou en retard.
-- Staff : tous les membres venus. Membre : lui-même (même à zéro venue) et les membres consentants.
create function public.attendance_ranking(p_academy uuid, p_from date, p_to date)
returns table (person_id uuid, first_name text, last_name text, visits integer, rank integer, ranked_total integer, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_tz text;
  v_staff boolean;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_member(p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 400 then
    raise exception 'coachos:invalid_period' using errcode = 'P0001';
  end if;
  select a.timezone into v_tz from public.academies a where a.id = p_academy;
  v_staff := app_private.is_staff(p_academy);

  return query
  with counts as (
    select p.id, p.first_name, p.last_name, p.ranking_opt_in, (p.user_id is not distinct from v_uid) as me,
      (select count(*)::integer
         from public.attendance a
         join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
        where a.person_id = p.id and a.academy_id = p.academy_id and a.status in ('present', 'late')
          and s.starts_at >= (p_from::timestamp at time zone v_tz)
          and s.starts_at < (p_to::timestamp at time zone v_tz)) as visits
    from public.people p
    where p.academy_id = p_academy and p.archived_at is null and p.anonymized_at is null
  ), ranked as (
    select c.*,
      case when c.visits > 0 then (rank() over (order by c.visits desc))::integer end as rnk,
      (count(*) filter (where c.visits > 0) over ())::integer as total
    from counts c
  )
  select r.id, r.first_name, r.last_name, r.visits, r.rnk, r.total, r.me
  from ranked r
  where r.me or (r.visits > 0 and (v_staff or r.ranking_opt_in))
  order by r.rnk nulls last, lower(r.last_name), lower(r.first_name);
end
$$;

revoke all on function public.set_my_ranking_visibility(uuid, boolean) from public, anon;
revoke all on function public.attendance_ranking(uuid, date, date) from public, anon;
grant execute on function public.set_my_ranking_visibility(uuid, boolean) to authenticated;
grant execute on function public.attendance_ranking(uuid, date, date) to authenticated;
