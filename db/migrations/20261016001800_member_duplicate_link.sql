-- Doublons de fiches : un adhérent déjà saisi ou importé par le club qui crée ensuite son compte ne doit pas se retrouver avec deux fiches.
--
-- 1. Rattachement automatique : à l'arrivée d'un compte dans un club (code d'inscription, invitation), si une fiche ADULTE, active, sans compte,
--    porte la même adresse e-mail que le compte, le compte est rattaché à cette fiche au lieu d'en créer une nouvelle. Sans risque de
--    détournement : l'adresse du compte est confirmée (le lien reçu par e-mail prouve qu'elle appartient à la personne) et l'index unique
--    (club, e-mail) garantit qu'au plus une fiche la porte. Une fiche de mineur (adresse du responsable ou de l'enfant) n'est jamais rattachée ainsi.
--    Les fiches sans e-mail (la plupart des imports) ne peuvent pas être appariées sans risque : voir 2.
-- 2. Fusion par l'équipe : merge_member_duplicate(fiche à garder, fiche créée par le compte) rattache le compte à la fiche d'origine et supprime
--    la fiche en double. Réservée au propriétaire et aux administrateurs. Refusée si la fiche en double porte déjà des présences (rien n'est
--    perdu en silence) ; ses réservations sont reportées, ses choix de profil (téléphone, avatar, classement) aussi. L'adhérent valide de
--    nouveau son profil (majorité attestée par lui-même, jamais à sa place).

create or replace function app_private.ensure_member_record(p_academy uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_first text;
  v_last text;
  v_email text;
  v_verified boolean;
begin
  select id into v_id from public.people where academy_id = p_academy and user_id = p_user;
  if v_id is not null then
    return v_id;
  end if;
  select btrim(coalesce(nullif(btrim(pr.display_name), ''), split_part(coalesce(pr.email, ''), '@', 1))), nullif(btrim(pr.email), '')
    into v_name, v_email
  from public.profiles pr where pr.id = p_user;
  select coalesce(u.email_verified, false) into v_verified from auth.users u where u.id = p_user;

  -- Fiche existante portant la même adresse (adresse du compte confirmée, fiche adulte active et sans compte) : on s'y rattache.
  if v_email is not null and coalesce(v_verified, false) then
    update public.people o set user_id = p_user
    where o.academy_id = p_academy and lower(o.email) = lower(v_email) and o.user_id is null
      and o.birth_date is null and o.archived_at is null and o.anonymized_at is null
    returning o.id into v_id;
    if v_id is not null then
      perform app_private.write_audit(p_academy, p_user, 'member.linked_by_email', 'person', v_id, '{}'::jsonb);
      return v_id;
    end if;
  end if;

  v_name := left(coalesce(nullif(v_name, ''), 'Membre'), 160);
  v_first := left(split_part(v_name, ' ', 1), 80);
  v_last := left(btrim(substr(v_name, length(v_first) + 1)), 80);
  if v_last = '' then
    v_last := '·';
  end if;
  if v_email is not null and exists (select 1 from public.people o where o.academy_id = p_academy and lower(o.email) = lower(v_email)) then
    v_email := null;
  end if;
  insert into public.people (academy_id, first_name, last_name, email, user_id, joined_on)
  values (p_academy, v_first, v_last, v_email, p_user, current_date)
  returning id into v_id;
  return v_id;
end
$$;

create function public.merge_member_duplicate(p_keep uuid, p_dup uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_keep public.people%rowtype;
  v_dup public.people%rowtype;
  v_moved integer;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if p_keep is null or p_dup is null or p_keep = p_dup then
    raise exception 'coachos:merge_invalid' using errcode = 'P0001';
  end if;
  select * into v_keep from public.people where id = p_keep;
  if not found or not app_private.is_admin(v_keep.academy_id) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  select * into v_dup from public.people where id = p_dup and academy_id = v_keep.academy_id;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  -- Deux adultes actifs : la fiche d'origine n'a pas de compte, la fiche en double est celle d'un compte.
  if v_keep.user_id is not null or v_keep.birth_date is not null or v_keep.anonymized_at is not null or v_keep.archived_at is not null
     or v_dup.user_id is null or v_dup.birth_date is not null or v_dup.anonymized_at is not null or v_dup.archived_at is not null then
    raise exception 'coachos:merge_invalid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.attendance where person_id = p_dup) then
    raise exception 'coachos:merge_has_history' using errcode = 'P0001';
  end if;

  -- Réservations à venir : reportées sur la fiche d'origine (celles qui existent déjà pour la même séance l'emportent).
  update public.session_bookings b set person_id = p_keep
  where b.person_id = p_dup
    and not exists (select 1 from public.session_bookings k where k.session_id = b.session_id and k.person_id = p_keep);
  get diagnostics v_moved = row_count;

  -- Le compte quitte la fiche en double (libère l'index unique), qui est ensuite supprimée avec ce qui en dépend (photo, historique de grades).
  update public.people set user_id = null where id = p_dup;
  delete from public.people where id = p_dup;

  update public.people
  set user_id = v_dup.user_id,
      email = coalesce(email, v_dup.email),
      phone = coalesce(phone, v_dup.phone),
      avatar_style = case when v_dup.profile_completed_at is not null then v_dup.avatar_style else avatar_style end,
      ranking_opt_in = v_dup.ranking_opt_in
  where id = p_keep;

  perform app_private.write_audit(v_keep.academy_id, v_uid, 'member.duplicate_merged', 'person', p_keep,
    jsonb_build_object('bookings_moved', v_moved));
end
$$;
revoke all on function public.merge_member_duplicate(uuid, uuid) from public, anon;
grant execute on function public.merge_member_duplicate(uuid, uuid) to authenticated;
