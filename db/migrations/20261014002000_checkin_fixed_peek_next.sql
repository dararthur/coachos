-- QR fixe : quand aucun cours n'est pointable, l'adhérent apprend quel est le prochain cours et quand le pointage ouvre,
-- au lieu d'un « Aucun cours » sans heure qui l'incite à rescanner jusqu'à la limite de débit.
-- Mêmes contrôles qu'avant : checkin_fixed_candidates lève la même erreur pour une clé inconnue, un club en mode tournant
-- ou un appelant non membre, AVANT toute lecture du prochain cours.
create or replace function public.checkin_fixed_peek(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_academy public.academies%rowtype;
begin
  select jsonb_build_object(
    'sessions', coalesce(jsonb_agg(jsonb_build_object(
      'session_id', c.session_id, 'class_name', c.class_name, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'booking', (select b.status from public.session_bookings b where b.session_id = c.session_id and b.person_id = c.person_id),
      'status', (select a.status from public.attendance a where a.session_id = c.session_id and a.person_id = c.person_id)
    ) order by (exists (select 1 from public.session_bookings b where b.session_id = c.session_id and b.person_id = c.person_id and b.status = 'booked')) desc, c.starts_at), '[]'::jsonb)
  ) into v_result
  from app_private.checkin_fixed_candidates(p_key) c;

  select a.* into v_academy from public.academy_checkin_keys k join public.academies a on a.id = k.academy_id where k.key = p_key;
  return v_result || jsonb_build_object(
    'timezone', v_academy.timezone,
    'before_minutes', v_academy.checkin_before_minutes,
    -- Prochain cours dont le pointage n'est pas encore ouvert (nom et début seulement).
    'next', (
      select jsonb_build_object('class_name', ct.name, 'starts_at', s.starts_at)
      from public.sessions s
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where s.academy_id = v_academy.id and s.status = 'scheduled'
        and s.starts_at - make_interval(mins => v_academy.checkin_before_minutes) > now()
      order by s.starts_at
      limit 1
    )
  );
end
$$;
