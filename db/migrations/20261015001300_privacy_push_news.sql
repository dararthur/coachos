-- Coach OS — droit d'accès (art. 15) : l'export du compte couvre aussi les notifications push (0011) et les actualités (0010).
--
-- Un appareil abonné aux notifications est un identifiant rattaché au compte : l'export indique l'appareil (date, service de
-- notification du navigateur, ex. fcm.googleapis.com) mais jamais l'adresse complète ni les clés de chiffrement (secrets de
-- l'abonnement). Les actualités rédigées par le compte sont du contenu du club (elles lui restent à la suppression du compte :
-- l'auteur est alors effacé, clé étrangère `on delete set null`) ; l'export en donne le titre et la date.
-- Le reste de la fonction est identique à la version de 0004_minors (photo, sessions, demandes de club, enfants).

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
    'push_devices', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', d.created_at,
                                          'push_service', substring(d.endpoint from '^https://([^/]+)')) order by d.created_at)
      from public.push_subscriptions d where d.user_id = v_uid
    ), '[]'::jsonb),
    'academies', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'role', m.role, 'since', m.created_at))
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    'authored_posts', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'title', c.title, 'visibility', c.visibility,
                                          'created_at', c.created_at) order by c.created_at)
      from public.club_posts c join public.academies a on a.id = c.academy_id
      where c.author_id = v_uid
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
    ), '[]'::jsonb),
    -- Enfants dont ce compte est le responsable légal.
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'birth_date', p.birth_date,
        'ranking_opt_in', p.ranking_opt_in, 'consent_confirmed_at', g.consent_confirmed_at,
        'consent_withdrawn_at', g.consent_withdrawn_at,
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.guardianships g
      join public.people p on p.id = g.child_id and p.academy_id = g.academy_id
      join public.academies a on a.id = g.academy_id
      where g.guardian_user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
