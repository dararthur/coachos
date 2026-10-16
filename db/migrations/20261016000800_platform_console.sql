-- Coach OS — console d'administration de la plateforme (lecture seule), livraison 1.
--
-- L'administrateur de la plateforme (platform_admins, désigné par PLATFORM_ADMIN_EMAIL) voit l'ensemble des clubs : combien, lesquels sont actifs,
-- ce qui se passe. Il ne voit AUCUNE donnée de membre : uniquement des compteurs par club et le contact du propriétaire (nécessaire au support).
-- Les fonctions sont les seules portes (les tables restent fermées) et refusent tout autre compte, même confirmé, avec 42501.

-- ---------------------------------------------------------------------------
-- Liste des clubs et activité récente
-- ---------------------------------------------------------------------------
create function public.admin_list_clubs() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    select a.id, a.name, a.timezone, a.created_at,
           (select u.email from public.academy_memberships m join auth.users u on u.id = m.user_id
             where m.academy_id = a.id and m.role = 'owner' order by m.created_at limit 1),
           (select count(*)::integer from public.people p where p.academy_id = a.id and p.archived_at is null and p.anonymized_at is null),
           (select count(*)::integer from public.academy_memberships m where m.academy_id = a.id and m.role in ('owner', 'admin', 'coach')),
           (select count(*)::integer from public.sessions s where s.academy_id = a.id and s.status = 'scheduled' and s.starts_at > now() - interval '30 days' and s.starts_at <= now()),
           (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '7 days'),
           (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '30 days'),
           (select max(e.created_at) from public.usage_events e where e.academy_id = a.id)
    from public.academies a
    order by a.created_at desc;
end
$$;

-- ---------------------------------------------------------------------------
-- Vue d'ensemble : une ligne de chiffres globaux + les événements d'usage des 30 derniers jours par type
-- ---------------------------------------------------------------------------
create function public.admin_overview() returns table (
  clubs integer, active_clubs_30d integer, members integer, accounts integer,
  pending_requests integer, events_7d integer, events_30d integer, by_event jsonb,
  db_size_bytes bigint, db_version text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    select (select count(*)::integer from public.academies),
           (select count(distinct e.academy_id)::integer from public.usage_events e where e.created_at > now() - interval '30 days'),
           (select count(*)::integer from public.people p where p.archived_at is null and p.anonymized_at is null),
           (select count(*)::integer from auth.users),
           (select count(*)::integer from public.academy_requests r where r.status = 'pending'),
           (select count(*)::integer from public.usage_events e where e.created_at > now() - interval '7 days'),
           (select count(*)::integer from public.usage_events e where e.created_at > now() - interval '30 days'),
           coalesce((select jsonb_object_agg(t.event, t.n) from (
             select e.event, count(*)::integer as n from public.usage_events e where e.created_at > now() - interval '30 days' group by e.event) t), '{}'::jsonb),
           pg_database_size(current_database()),
           current_setting('server_version');
end
$$;

revoke all on function public.admin_list_clubs() from public, anon;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_list_clubs() to authenticated;
grant execute on function public.admin_overview() to authenticated;
