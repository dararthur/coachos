-- Coach OS — 0005 droits des personnes (export, effacement), suppression de compte/académie, purge.
-- Voir docs/privacy-gdpr.md pour les finalités, durées de conservation et procédures.

-- Effacement d'un membre. Deux modes :
--   'anonymize' : identité effacée, présences conservées sous forme de statistiques non identifiantes ;
--   'delete'    : suppression complète de la fiche et de ses présences.
create function public.erase_person(p_person uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
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

-- Export des données d'un membre (droit d'accès / portabilité), à la demande de l'intéressé auprès du club.
create function public.export_person_data(p_person uuid) returns jsonb
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
      'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
      'joined_on', p.joined_on, 'external_ref', p.external_ref,
      'adult_attested_at', p.adult_attested_at, 'archived_at', p.archived_at, 'created_at', p.created_at
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', at.status, 'recorded_at', at.recorded_at
      ) order by s.starts_at)
      from public.attendance at
      join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where at.person_id = p.id and at.academy_id = p.academy_id
    ), '[]'::jsonb)
  ) into v_result
  from public.people p where p.id = p_person;

  perform app_private.write_audit(v_academy, v_uid, 'member.data_exported', 'person', p_person, '{}'::jsonb);
  return v_result;
end
$$;

-- Export des données du compte connecté.
create function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  perform app_private.write_audit(null, v_uid, 'account.data_exported', 'user', v_uid, '{}'::jsonb);
  return jsonb_build_object(
    'generated_at', now(),
    'profile', (select jsonb_build_object('email', p.email, 'display_name', p.display_name, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'academies', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'role', m.role, 'since', m.created_at))
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    'member_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
        'joined_on', p.joined_on,
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.people p join public.academies a on a.id = p.academy_id
      where p.user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;

-- Suppression du compte connecté. Refusée tant que l'utilisateur est le seul propriétaire d'une académie.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
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

  -- Les journaux d'audit ne conservent plus d'identifiant rattachable à la personne.
  update public.audit_events set actor_user_id = null where actor_user_id = v_uid;
  perform app_private.write_audit(null, null, 'account.deleted', null, null, '{}'::jsonb);
  delete from auth.users where id = v_uid;
end
$$;

-- Suppression définitive d'une académie et de toutes ses données (propriétaire, confirmation par le nom).
create function public.delete_academy(p_academy uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_owner(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.academies where id = p_academy;
  if v_name is distinct from btrim(p_confirm_name) then
    raise exception 'coachos:confirmation_mismatch' using errcode = 'P0001';
  end if;
  delete from public.academies where id = p_academy;
  perform app_private.write_audit(p_academy, v_uid, 'academy.deleted', 'academy', p_academy, '{}'::jsonb);
end
$$;

-- Purge de rétention, exécutée périodiquement par la tâche planifiée (app_server uniquement).
--   * membres archivés depuis plus de `retention_months` => anonymisation ;
--   * invitations expirées ou acceptées depuis > 30 jours => suppression (adresses e-mail) ;
--   * journaux d'audit > 24 mois, compteurs de limitation de débit > 1 jour => suppression.
create function app_private.purge_expired_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_anonymized integer;
  v_invitations integer;
  v_audit integer;
  v_rate integer;
begin
  with target as (
    select p.id, p.academy_id from public.people p
    join public.academies a on a.id = p.academy_id
    where p.archived_at is not null and p.anonymized_at is null
      and p.archived_at < now() - make_interval(months => a.retention_months)
  ), done as (
    update public.people p
    set first_name = 'Membre', last_name = 'anonymisé', email = null, external_ref = null,
        user_id = null, joined_on = null, anonymized_at = now()
    from target t where p.id = t.id and p.academy_id = t.academy_id
    returning p.id, p.academy_id
  ), audit as (
    select app_private.write_audit(academy_id, null, 'member.anonymized_by_retention', 'person', id, '{}'::jsonb)
    from done
  )
  select count(*) into v_anonymized from audit;

  delete from public.invitations
  where (accepted_at is not null and accepted_at < now() - interval '30 days')
     or (accepted_at is null and expires_at < now() - interval '30 days');
  get diagnostics v_invitations = row_count;

  delete from public.audit_events where created_at < now() - interval '24 months';
  get diagnostics v_audit = row_count;

  delete from app_private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  return jsonb_build_object(
    'members_anonymized', v_anonymized, 'invitations_deleted', v_invitations,
    'audit_events_deleted', v_audit, 'rate_limits_deleted', v_rate
  );
end
$$;

revoke all on function public.erase_person(uuid, text) from public, anon;
revoke all on function public.export_person_data(uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.delete_academy(uuid, text) from public, anon;
grant execute on function public.erase_person(uuid, text) to authenticated;
grant execute on function public.export_person_data(uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.delete_academy(uuid, text) to authenticated;

revoke all on function app_private.purge_expired_data() from public, anon, authenticated;
grant execute on function app_private.purge_expired_data() to app_server;
