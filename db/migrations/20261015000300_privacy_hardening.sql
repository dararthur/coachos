-- Coach OS — durcissement RGPD avant l'ouverture aux données réelles (voir docs/rgpd/).
--
-- 1. Droit d'accès (art. 15) : les exports omettaient la photo de profil (0014), les sessions de connexion et les
--    demandes de création de club (0018). Ils sont complétés ; l'adresse IP de session, déjà pseudonymisée par HMAC,
--    n'est pas exportée (elle n'est pas lisible sans le secret du serveur et ne renseigne pas la personne).
-- 2. Suppression du compte (art. 17) : la fiche membre reste au club (responsable de traitement), mais ce que la
--    personne a elle-même fourni ou consenti via son compte disparaît avec lui : photo de profil, consentement au
--    classement (art. 7 §3 : le retrait doit être aussi simple que le don), demandes de création de club à son adresse,
--    et l'identifiant du compte dans le journal d'audit (entity_id, en plus de actor_user_id déjà effacé en 0005).
-- Les signatures, droits et réponses (404 pour un non-admin) sont inchangés.

create or replace function public.export_person_data(p_person uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.people where id = p_person;
  if v_academy is null or not app_private.is_admin(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'academy', (select a.name from public.academies a where a.id = v_academy),
    'person', jsonb_build_object(
      'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
      'belt', p.belt, 'belt_stripes', p.belt_stripes, 'avatar_style', p.avatar_style, 'ranking_opt_in', p.ranking_opt_in,
      'joined_on', p.joined_on, 'external_ref', p.external_ref,
      'adult_attested_at', p.adult_attested_at, 'archived_at', p.archived_at, 'created_at', p.created_at,
      'has_account', p.user_id is not null
    ),
    'photo', (
      select jsonb_build_object('content_type', ph.content_type, 'updated_at', ph.updated_at,
                                'data_base64', translate(encode(ph.data, 'base64'), E'\n', ''))
      from public.person_photos ph where ph.person_id = p.id and ph.academy_id = p.academy_id
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', at.status, 'recorded_at', at.recorded_at
      ) order by s.starts_at)
      from public.attendance at
      join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where at.person_id = p.id and at.academy_id = p.academy_id
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', b.status, 'booked_at', b.created_at
      ) order by s.starts_at)
      from public.session_bookings b
      join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where b.person_id = p.id and b.academy_id = p.academy_id
    ), '[]'::jsonb)
  ) into v_result
  from public.people p where p.id = p_person;

  perform app_private.write_audit(v_academy, v_uid, 'member.data_exported', 'person', p_person, '{}'::jsonb);
  return v_result;
end
$$;

create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select email into v_email from auth.users where id = v_uid;
  perform app_private.write_audit(null, v_uid, 'account.data_exported', 'user', v_uid, '{}'::jsonb);
  return jsonb_build_object(
    'generated_at', now(),
    'profile', (select jsonb_build_object('email', p.email, 'display_name', p.display_name, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'last_refreshed_at', s.updated_at,
                                          'expires_at', s.expires_at, 'user_agent', s.user_agent) order by s.created_at)
      from auth.sessions s where s.user_id = v_uid
    ), '[]'::jsonb),
    'academies', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'role', m.role, 'since', m.created_at))
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    -- Demandes faites avec l'adresse du compte (ce compte l'a confirmée, sans quoi la connexion est refusée).
    'club_requests', coalesce((
      select jsonb_agg(jsonb_build_object('club_name', r.name, 'contact_name', r.contact_name, 'email', r.email,
                                          'note', r.note, 'status', r.status, 'created_at', r.created_at,
                                          'decided_at', r.decided_at) order by r.created_at)
      from public.academy_requests r where r.email = v_email
    ), '[]'::jsonb),
    'member_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
        'belt', p.belt, 'belt_stripes', p.belt_stripes, 'avatar_style', p.avatar_style, 'ranking_opt_in', p.ranking_opt_in,
        'joined_on', p.joined_on,
        'photo', (
          select jsonb_build_object('content_type', ph.content_type, 'updated_at', ph.updated_at,
                                    'data_base64', translate(encode(ph.data, 'base64'), E'\n', ''))
          from public.person_photos ph where ph.person_id = p.id and ph.academy_id = p.academy_id
        ),
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb),
        'bookings', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', b.status) order by s.starts_at)
          from public.session_bookings b join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
          where b.person_id = p.id and b.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.people p join public.academies a on a.id = p.academy_id
      where p.user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if exists (
    select 1 from public.academy_memberships m
    where m.user_id = v_uid and m.role = 'owner'
      and not exists (
        select 1 from public.academy_memberships o
        where o.academy_id = m.academy_id and o.role = 'owner' and o.user_id <> v_uid
      )
  ) then
    raise exception 'coachos:sole_owner' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = v_uid;

  -- Ce que la personne a fourni ou consenti via son compte disparaît avec lui ; la fiche reste au club.
  delete from public.person_photos ph using public.people p
  where p.user_id = v_uid and ph.person_id = p.id and ph.academy_id = p.academy_id;
  update public.people set ranking_opt_in = false where user_id = v_uid and ranking_opt_in;
  delete from public.academy_requests where email = v_email;

  -- Les journaux d'audit ne conservent plus d'identifiant rattachable à la personne.
  update public.audit_events set actor_user_id = null where actor_user_id = v_uid;
  update public.audit_events set entity_id = null where entity_type = 'user' and entity_id = v_uid;
  perform app_private.write_audit(null, null, 'account.deleted', null, null, '{}'::jsonb);
  delete from auth.users where id = v_uid;
end
$$;

revoke all on function public.export_person_data(uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.export_person_data(uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
