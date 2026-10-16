-- Coach OS — export « Éligibles au grade suivant » : journalisation de l'export (compteur seulement, comme les autres exports).
--
-- Les exports de membres et de présences sont réservés aux administrateurs ; celui-ci est ouvert à toute l'équipe qui voit la liste
-- (propriétaire, administrateur, coach), donc l'action 'promotions.exported' se journalise avec le droit « équipe » au lieu de « administrateur ».

create or replace function public.record_event(p_academy uuid, p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('members.imported', 'members.exported', 'attendance.exported', 'promotions.exported') then
    raise exception 'coachos:invalid_action' using errcode = 'P0001';
  end if;
  if not (case when p_action = 'promotions.exported' then app_private.is_staff(p_academy) else app_private.is_admin(p_academy) end) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  -- Seuls des compteurs numériques sont conservés dans l'audit.
  perform app_private.write_audit(
    p_academy, v_uid, p_action, null, null,
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
       from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as t(k, v)
      where jsonb_typeof(v) = 'number' and char_length(k) <= 30)
  );
end
$$;
