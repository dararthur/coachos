-- Coach OS — récapitulatif hebdomadaire des chiffres clés (e-mail à l'administrateur de la plateforme, le dimanche à 20 h).
--
-- Le récapitulatif est préparé par le serveur (tâche planifiée, sans compte connecté) : il lit les mêmes chiffres que la console, via des
-- fonctions réservées à app_server. Pour ne pas dupliquer la requête des clubs, son cœur devient app_private.club_overview() et
-- public.admin_list_clubs() n'est plus qu'un contrôle d'accès devant lui. Aucune donnée de membre : des compteurs et des noms de clubs.

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check check (job in ('reminders', 'close_rolls', 'purge', 'weekly_digest'));

-- Cœur de la liste des clubs (sans contrôle d'accès : jamais exposé à un compte).
create function app_private.club_overview() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz, disabled_features text[],
  events_prev_30d integer,
  plan_name text, subscription_status text, renews_on date, price_cents integer,
  suspended_at timestamptz
)
language sql stable security definer set search_path = '' as $$
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
         (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '60 days' and e.created_at <= now() - interval '30 days'),
         s.plan_name, s.status, s.renews_on, s.price_cents,
         z.suspended_at
  from public.academies a
  left join public.club_subscriptions s on s.academy_id = a.id
  left join public.club_suspensions z on z.academy_id = a.id
  order by a.created_at desc
$$;
revoke all on function app_private.club_overview() from public, anon, authenticated;
grant execute on function app_private.club_overview() to app_server;

create or replace function public.admin_list_clubs() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz, disabled_features text[],
  events_prev_30d integer,
  plan_name text, subscription_status text, renews_on date, price_cents integer,
  suspended_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query select * from app_private.club_overview();
end
$$;

-- Le reste du récapitulatif : demandes en attente, nouveaux clubs et comptes de la semaine, tâches, envois des 7 derniers jours.
create function app_private.digest_extra() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending_requests', (select count(*) from public.academy_requests r where r.status = 'pending'),
    'new_clubs_7d', (select count(*) from public.academies a where a.created_at > now() - interval '7 days'),
    'new_accounts_7d', (select count(*) from auth.users u where u.created_at > now() - interval '7 days'),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'job', j.job, 'last_run_at', j.last_run_at, 'last_success_at', j.last_success_at, 'last_failure_at', j.last_failure_at) order by j.job)
      from public.job_runs j), '[]'::jsonb),
    'counters_7d', coalesce((select jsonb_object_agg(c.metric, c.n) from (
        select metric, sum(n)::bigint as n from public.platform_counters where day > current_date - 7 group by metric) c), '{}'::jsonb)
  )
$$;
revoke all on function app_private.digest_extra() from public, anon, authenticated;
grant execute on function app_private.digest_extra() to app_server;

-- Dernier succès d'une tâche (pour ne pas envoyer le récapitulatif deux fois la même semaine).
create function app_private.job_last_success(p_job text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select j.last_success_at from public.job_runs j where j.job = p_job
$$;
revoke all on function app_private.job_last_success(text) from public, anon, authenticated;
grant execute on function app_private.job_last_success(text) to app_server;
