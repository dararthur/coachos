-- Coach OS — 0015 classement : grade, silhouette et présence d'une photo pour chaque ligne.
--
-- Un membre ne lit pas les fiches des autres : ces informations ne peuvent venir que de la fonction de classement, qui ne renvoie
-- déjà que sa propre ligne et celles des membres consentants (ou toutes, pour le staff). Aucune ligne supplémentaire n'est exposée.

drop function public.attendance_ranking(uuid, date, date);

create function public.attendance_ranking(p_academy uuid, p_from date, p_to date)
returns table (
  person_id uuid, first_name text, last_name text, visits integer, rank integer, ranked_total integer, is_me boolean,
  belt text, belt_stripes integer, avatar_style text, has_photo boolean
)
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
    select p.id, p.first_name, p.last_name, p.ranking_opt_in, p.belt, p.belt_stripes::integer as belt_stripes, p.avatar_style,
      exists (select 1 from public.person_photos ph where ph.person_id = p.id) as has_photo, (p.user_id is not distinct from v_uid) as me,
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
  select r.id, r.first_name, r.last_name, r.visits, r.rnk, r.total, r.me, r.belt, r.belt_stripes, r.avatar_style, r.has_photo
  from ranked r
  where r.me or (r.visits > 0 and (v_staff or r.ranking_opt_in))
  order by r.rnk nulls last, lower(r.last_name), lower(r.first_name);
end
$$;

revoke all on function public.attendance_ranking(uuid, date, date) from public, anon;
grant execute on function public.attendance_ranking(uuid, date, date) to authenticated;
