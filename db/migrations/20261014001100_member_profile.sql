-- Coach OS — 0011 profil du membre et création AUTOMATIQUE de sa fiche à l'inscription.
--
-- Un membre qui rejoint un club (invitation aujourd'hui, code ou lien ensuite) obtient immédiatement sa fiche, liée à son compte,
-- sans action du coach. Il complète ensuite lui-même son profil : identité, téléphone, grade (ceinture + barrettes), silhouette.
-- La majorité est attestée par le membre lui-même (people.adult_attested_at est alors renseigné à la validation du profil).

alter table public.people
  add column belt text check (belt is null or belt in ('white', 'blue', 'purple', 'brown', 'black')),
  add column belt_stripes smallint not null default 0 check (belt_stripes between 0 and 4),
  add column avatar_style text not null default 'neutral' check (avatar_style in ('woman', 'man', 'neutral')),
  add column profile_completed_at timestamptz;

-- Une fiche créée par le membre lui-même (user_id renseigné) n'est attestée majeure qu'une fois son profil validé.
alter table public.people drop constraint people_check;
alter table public.people add constraint people_adult_attested_check
  check (anonymized_at is not null or adult_attested_at is not null or user_id is not null);

-- L'horodatage d'attestation reste posé par la base pour les fiches créées par le staff (user_id null) ;
-- il n'est jamais posé à la place du membre.
create or replace function app_private.stamp_person_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  if new.user_id is null then
    new.adult_attested_at := now();
  else
    new.adult_attested_at := null;
  end if;
  return new;
end
$$;

-- Le staff corrige le grade (mêmes règles que les autres champs de la fiche : administrateurs, via la RLS).
grant update (belt, belt_stripes) on public.people to authenticated;

-- Une fiche par compte et par club : crée la fiche du compte si elle n'existe pas. Le nom vient du nom de compte (le membre le corrige).
create function app_private.ensure_member_record(p_academy uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_first text;
  v_last text;
begin
  select id into v_id from public.people where academy_id = p_academy and user_id = p_user;
  if v_id is not null then
    return v_id;
  end if;
  select btrim(coalesce(nullif(btrim(pr.display_name), ''), split_part(coalesce(pr.email, ''), '@', 1))) into v_name
  from public.profiles pr where pr.id = p_user;
  v_name := left(coalesce(nullif(v_name, ''), 'Membre'), 160);
  v_first := left(split_part(v_name, ' ', 1), 80);
  v_last := left(btrim(substr(v_name, length(v_first) + 1)), 80);
  if v_last = '' then
    v_last := '·';
  end if;
  insert into public.people (academy_id, first_name, last_name, user_id, joined_on)
  values (p_academy, v_first, v_last, p_user, current_date)
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function app_private.ensure_member_record(uuid, uuid) from public;

-- accept_invitation (0004/0007) : identique, avec la fiche créée automatiquement pour un membre sans fiche pré-créée.
create or replace function public.accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed boolean;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select email, email_verified into v_email, v_confirmed from auth.users where id = v_uid;
  if not coalesce(v_confirmed, false) then
    raise exception 'coachos:email_not_confirmed' using errcode = 'P0001';
  end if;

  select * into v_inv from public.invitations
  where token_hash = p_token_hash and accepted_at is null and expires_at > now()
  for update;
  if not found or lower(v_email) <> v_inv.email then
    raise exception 'coachos:invitation_invalid' using errcode = 'P0001';
  end if;

  insert into public.academy_memberships (academy_id, user_id, role)
  values (v_inv.academy_id, v_uid, v_inv.role)
  on conflict (academy_id, user_id) do nothing;

  if v_inv.person_id is not null then
    update public.people set user_id = v_uid
    where id = v_inv.person_id and academy_id = v_inv.academy_id and user_id is null
      and not exists (select 1 from public.people o
                      where o.academy_id = v_inv.academy_id and o.user_id = v_uid);
  end if;
  if v_inv.role = 'member' then
    perform app_private.ensure_member_record(v_inv.academy_id, v_uid);
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  perform app_private.write_audit(v_inv.academy_id, v_uid, 'team.joined', 'invitation', v_inv.id,
    jsonb_build_object('role', v_inv.role));
  return v_inv.academy_id;
end
$$;

-- Profil du membre connecté pour SA fiche. La validation (p_confirm_adult) pose l'attestation de majorité et la date de complétion.
create function public.update_my_profile(
  p_academy uuid, p_first_name text, p_last_name text, p_phone text,
  p_belt text, p_belt_stripes integer, p_avatar_style text, p_confirm_adult boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_person public.people%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_person from public.people
  where academy_id = p_academy and user_id = v_uid and anonymized_at is null and archived_at is null
  for update;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_person.adult_attested_at is null and not coalesce(p_confirm_adult, false) then
    raise exception 'coachos:adult_required' using errcode = 'P0001';
  end if;
  update public.people set
    first_name = p_first_name, last_name = p_last_name, phone = p_phone,
    belt = p_belt, belt_stripes = coalesce(p_belt_stripes, 0), avatar_style = coalesce(p_avatar_style, 'neutral'),
    adult_attested_at = coalesce(adult_attested_at, now()),
    profile_completed_at = coalesce(profile_completed_at, now())
  where id = v_person.id;
  perform app_private.write_audit(p_academy, v_uid, 'member.profile_updated', 'person', v_person.id, '{}'::jsonb);
end
$$;
revoke all on function public.update_my_profile(uuid, text, text, text, text, integer, text, boolean) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text, text, text, integer, text, boolean) to authenticated;

-- Rattrapage : les comptes déjà membres d'un club sans fiche en reçoivent une.
do $$
declare
  r record;
begin
  for r in
    select m.academy_id, m.user_id from public.academy_memberships m
    where m.role = 'member'
      and not exists (select 1 from public.people p where p.academy_id = m.academy_id and p.user_id = m.user_id)
  loop
    perform app_private.ensure_member_record(r.academy_id, r.user_id);
  end loop;
end
$$;

-- Anonymisation : le grade et la silhouette sont effacés avec le reste du profil (en plus du téléphone et du consentement, 0009/0010).
create or replace function app_private.people_clear_phone_on_anonymize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.anonymized_at is not null then
    new.phone := null;
    new.ranking_opt_in := false;
    new.belt := null;
    new.belt_stripes := 0;
    new.avatar_style := 'neutral';
  end if;
  return new;
end
$$;
