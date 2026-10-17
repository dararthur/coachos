-- Suspension d'un club : fermer aussi les chemins qui ne passent pas par l'adhésion (audit du 2026-10-17).
--
-- La migration 20261016001500 ferme un club suspendu en faisant répondre « non » à member_role / is_member. Trois chemins n'utilisaient pas
-- ces briques et restaient ouverts :
--   1. le responsable légal (souvent sans adhésion au club) : liste de ses enfants, cours de l'enfant, réservation, annulation,
--      visibilité au classement, invitation du compte de l'enfant. Il pouvait donc réserver dans un club suspendu ;
--   2. can_record_attendance (RLS d'écriture des présences) lisait l'adhésion directement : un coach d'un club suspendu pouvait encore
--      écrire une présence en base (l'application l'en empêchait, la base non) ;
--   3. shares_academy_with_staff (RLS des profils) : le staff d'un club suspendu lisait encore les profils de ses membres.
-- Le retrait du consentement reste possible pendant une suspension (droit de la personne, RGPD art. 7.3), comme l'export des données.

create or replace function app_private.guardian_child_academy(p_child uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child and guardian_user_id = v_uid;
  if not found or app_private.is_suspended(v_g.academy_id) then
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

create or replace function public.my_children()
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
    and not app_private.is_suspended(g.academy_id)
  order by p.first_name
$$;

create or replace function public.set_child_ranking_visibility(p_child uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child and guardian_user_id = v_uid;
  if not found or app_private.is_suspended(v_g.academy_id) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_g.consent_confirmed_at is null or v_g.consent_withdrawn_at is not null then
    raise exception 'coachos:consent_required' using errcode = 'P0001';
  end if;
  update public.people set ranking_opt_in = coalesce(p_visible, false)
  where id = p_child and academy_id = v_g.academy_id and anonymized_at is null and archived_at is null;
  perform app_private.write_audit(v_g.academy_id, v_uid, 'member.ranking_visibility', 'person', p_child,
    jsonb_build_object('visible', coalesce(p_visible, false), 'by', 'guardian'));
end
$$;

create or replace function public.invite_minor_account(p_child uuid, p_email text, p_token_hash text) returns uuid
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
  if not found or app_private.is_suspended(v_g.academy_id) or not (v_g.guardian_user_id = v_uid or app_private.is_admin(v_g.academy_id)) then
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

create or replace function app_private.can_record_attendance(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.sessions s
    join public.academy_memberships m on m.academy_id = s.academy_id and m.user_id = (select auth.uid())
    where s.id = p_session
      and not app_private.is_suspended(s.academy_id)
      and (
        m.role in ('owner', 'admin')
        or (m.role = 'coach' and (s.instructor_id is null or s.instructor_id = m.user_id))
      )
  );
$$;

create or replace function app_private.shares_academy_with_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.academy_memberships me
    join public.academy_memberships other on other.academy_id = me.academy_id
    where me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin', 'coach')
      and other.user_id = p_user
      and not app_private.is_suspended(me.academy_id)
  );
$$;
