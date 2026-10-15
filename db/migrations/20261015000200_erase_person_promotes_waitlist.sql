-- Coach OS — effacement complet d'un membre : la liste d'attente avance.
-- Le DELETE de la fiche supprimait les réservations par cascade sans promouvoir personne : la place libérée restait
-- vide jusqu'à la prochaine annulation. On retire d'abord les réservations explicitement (comme
-- app_private.people_drop_bookings pour l'archivage/l'anonymisation) et on promeut pour chaque place 'booked' libérée.
-- Le reste de la fonction est inchangé (droits, audit, 404 pour un non-admin).
create or replace function public.erase_person(p_person uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if p_mode not in ('anonymize', 'delete') then
    raise exception 'coachos:invalid_mode' using errcode = 'P0001';
  end if;
  select academy_id into v_academy from public.people where id = p_person;
  -- Même réponse qu'une fiche inexistante si l'appelant n'est pas admin de l'académie (pas d'oracle d'existence).
  if v_academy is null or not app_private.is_admin(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;

  delete from public.invitations where person_id = p_person and academy_id = v_academy;
  if p_mode = 'delete' then
    for r in delete from public.session_bookings where person_id = p_person and academy_id = v_academy returning session_id, status loop
      if r.status = 'booked' then
        perform app_private.promote_waitlist(r.session_id);
      end if;
    end loop;
    delete from public.people where id = p_person and academy_id = v_academy;
  else
    update public.people
    set first_name = 'Membre', last_name = 'anonymisé', email = null, external_ref = null,
        user_id = null, joined_on = null,
        archived_at = coalesce(archived_at, now()), anonymized_at = now()
    where id = p_person and academy_id = v_academy;
  end if;
  perform app_private.write_audit(v_academy, v_uid,
    case p_mode when 'delete' then 'member.deleted' else 'member.anonymized' end,
    'person', p_person, '{}'::jsonb);
end
$$;
