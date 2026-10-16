-- Coach OS — tendances d'usage et clubs à surveiller (console de l'administrateur de la plateforme).
--
-- Deux ajouts de lecture, sans nouvelle donnée : l'usage des 30 jours précédents dans la liste des clubs (pour repérer une baisse) et une
-- série mensuelle sur 13 mois par type d'événement, pour tous les clubs ou pour un seul. Comptes agrégés uniquement, aucune donnée de membre.

drop function public.admin_list_clubs();
create function public.admin_list_clubs() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz, disabled_features text[],
  events_prev_30d integer
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
           (select max(e.created_at) from public.usage_events e where e.academy_id = a.id),
           coalesce((select array_agg(c.feature order by c.feature) from public.club_features c where c.academy_id = a.id and not c.enabled), '{}'),
           (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '60 days' and e.created_at <= now() - interval '30 days')
    from public.academies a
    order by a.created_at desc;
end
$$;
revoke all on function public.admin_list_clubs() from public, anon;
grant execute on function public.admin_list_clubs() to authenticated;

-- Série mensuelle des 13 derniers mois (le mois en cours compris) : p_academy null = tous les clubs.
create function public.admin_usage_series(p_academy uuid default null) returns table (month date, event text, n integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', e.created_at)::date, e.event, count(*)::integer
    from public.usage_events e
    where (p_academy is null or e.academy_id = p_academy)
      and e.created_at >= date_trunc('month', now()) - interval '12 months'
    group by 1, 2
    order by 1, 2;
end
$$;
revoke all on function public.admin_usage_series(uuid) from public, anon;
grant execute on function public.admin_usage_series(uuid) to authenticated;
