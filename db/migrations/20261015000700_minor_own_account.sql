-- Coach OS — 0027 compte propre FACULTATIF pour un mineur de 15 ans et plus, avec l'accord de son responsable légal.
--
--   * Le compte se crée par une invitation liée à la fiche existante (même mécanisme que les adhérents, 0004/0011) ; elle ne peut être
--     émise que par le responsable légal rattaché (ou un administrateur du club) APRÈS confirmation de l'accord, et seulement dès 15 ans
--     (art. 45 loi Informatique et Libertés : consentement du mineur seul possible à partir de 15 ans ; ici l'accord du parent est en plus requis).
--   * Le mineur valide son profil sans attester sa majorité ; sa fiche reste une fiche de mineur (date de naissance, responsable).
--   * Il ne peut ni activer le classement ni déposer de photo : ces choix restent au responsable.
--   * Le retrait de l'accord délie le compte et retire l'appartenance au club.

-- Invitation du mineur (le lien est remis au responsable, qui le transmet à son enfant).
create function public.invite_minor_account(p_child uuid, p_email text, p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
  v_p public.people%rowtype;
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child;
  if not found or not (v_g.guardian_user_id = v_uid or app_private.is_admin(v_g.academy_id)) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_g.consent_confirmed_at is null or v_g.consent_withdrawn_at is not null then
    raise exception 'coachos:consent_required' using errcode = 'P0001';
  end if;
  select * into v_p from public.people where id = p_child and academy_id = v_g.academy_id and anonymized_at is null and archived_at is null;
  if not found or v_p.user_id is not null or v_p.birth_date is null then
    raise exception 'coachos:invalid_person' using errcode = 'P0001';
  end if;
  if v_p.birth_date > (current_date - interval '15 years')::date then
    raise exception 'coachos:minor_too_young' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'coachos:invalid_email' using errcode = 'P0001';
  end if;
  delete from public.invitations where academy_id = v_g.academy_id and email = v_email and accepted_at is null;
  perform set_config('app.minor_invite', 'on', true);
  insert into public.invitations (academy_id, email, role, person_id, token_hash, invited_by, expires_at)
  values (v_g.academy_id, v_email, 'member', p_child, p_token_hash, v_uid, now() + interval '7 days')
  returning id into v_id;
  perform app_private.write_audit(v_g.academy_id, v_uid, 'member.minor_account_invited', 'person', p_child, '{}'::jsonb);
  return v_id;
end
$$;
revoke all on function public.invite_minor_account(uuid, text, text) from public, anon;
grant execute on function public.invite_minor_account(uuid, text, text) to authenticated;

-- Profil : un mineur ne certifie pas sa majorité et n'en reçoit pas l'attestation.
create or replace function public.update_my_profile(
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
  if v_person.adult_attested_at is null and v_person.birth_date is null and not coalesce(p_confirm_adult, false) then
    raise exception 'coachos:adult_required' using errcode = 'P0001';
  end if;
  update public.people set
    first_name = p_first_name, last_name = p_last_name, phone = p_phone,
    belt = p_belt, belt_stripes = coalesce(p_belt_stripes, 0), avatar_style = coalesce(p_avatar_style, 'neutral'),
    adult_attested_at = case when birth_date is null then coalesce(adult_attested_at, now()) else adult_attested_at end,
    profile_completed_at = coalesce(profile_completed_at, now())
  where id = v_person.id;
  perform app_private.write_audit(p_academy, v_uid, 'member.profile_updated', 'person', v_person.id, '{}'::jsonb);
end
$$;

-- Classement et photo : décisions du responsable. Le mineur titulaire du compte ne peut pas les activer lui-même.
create or replace function app_private.minor_ranking_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ranking_opt_in and app_private.is_minor(new.birth_date) then
    if new.user_id is not null and new.user_id = (select auth.uid()) then
      raise exception 'coachos:guardian_required' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.guardianships g where g.child_id = new.id and g.consent_confirmed_at is not null and g.consent_withdrawn_at is null) then
      new.ranking_opt_in := false;
    end if;
  end if;
  return new;
end
$$;

create function app_private.minor_photo_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.people p where p.id = new.person_id and p.academy_id = new.academy_id and app_private.is_minor(p.birth_date)) then
    raise exception 'coachos:guardian_required' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app_private.minor_photo_guard() from public;
create trigger person_photos_minor_guard before insert or update on public.person_photos
  for each row execute function app_private.minor_photo_guard();

-- Retrait de l'accord : le compte du mineur est délié et son appartenance au club retirée.
create or replace function public.withdraw_guardian_consent(p_child uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
  v_user uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child;
  if not found or not (v_g.guardian_user_id = v_uid or app_private.is_admin(v_g.academy_id)) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  update public.guardianships set consent_withdrawn_at = now(), consent_token_hash = null where id = v_g.id;
  select user_id into v_user from public.people where id = p_child and academy_id = v_g.academy_id;
  update public.people set ranking_opt_in = false, archived_at = coalesce(archived_at, now()), user_id = null
  where id = p_child and academy_id = v_g.academy_id;
  if v_user is not null then
    delete from public.academy_memberships where academy_id = v_g.academy_id and user_id = v_user and role = 'member';
  end if;
  delete from public.invitations where person_id = p_child and academy_id = v_g.academy_id and accepted_at is null;
  delete from public.person_photos where person_id = p_child and academy_id = v_g.academy_id;
  perform app_private.write_audit(v_g.academy_id, v_uid, 'member.guardian_consent_withdrawn', 'person', p_child, '{}'::jsonb);
end
$$;

-- L'invitation d'équipe classique (create_invitation) ne peut pas lier un compte à une fiche de mineur : seule invite_minor_account le peut.
create function app_private.minor_invitation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.person_id is not null
     and coalesce(current_setting('app.minor_invite', true), '') <> 'on'
     and exists (select 1 from public.people p where p.id = new.person_id and p.academy_id = new.academy_id and p.birth_date is not null) then
    raise exception 'coachos:invalid_person' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app_private.minor_invitation_guard() from public;
create trigger invitations_minor_guard before insert on public.invitations
  for each row execute function app_private.minor_invitation_guard();

-- Espace du responsable : âge et existence d'un compte pour l'enfant.
drop function public.my_children();
create function public.my_children()
returns table (child_id uuid, academy_id uuid, academy_name text, first_name text, last_name text, ranking_opt_in boolean,
               consent_confirmed_at timestamptz, consent_withdrawn_at timestamptz, last_attended_at timestamptz,
               can_have_account boolean, has_account boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.academy_id, a.name, p.first_name, p.last_name, p.ranking_opt_in, g.consent_confirmed_at, g.consent_withdrawn_at,
         (select max(s.starts_at) from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id and at.status in ('present', 'late')),
         p.birth_date is not null and p.birth_date <= (current_date - interval '15 years')::date,
         p.user_id is not null
  from public.guardianships g
  join public.people p on p.id = g.child_id and p.academy_id = g.academy_id
  join public.academies a on a.id = g.academy_id
  where g.guardian_user_id = (select auth.uid()) and p.anonymized_at is null
  order by p.first_name
$$;
revoke all on function public.my_children() from public, anon;
grant execute on function public.my_children() to authenticated;
