-- Coach OS — supervision applicative : état des tâches planifiées et santé des envois (e-mails, notifications).
--
-- Aucune donnée personnelle : une ligne par tâche (dernier passage, dernier succès, dernier échec, code d'erreur court) et des compteurs
-- journaliers par type d'événement. Écrits par le serveur (app_server) ; lus uniquement par l'administrateur de la plateforme via
-- des fonctions qui refusent tout autre compte. La sauvegarde, lancée par systemd hors application, n'y figure pas (voir docs/monitoring.md).

create table public.job_runs (
  job text primary key check (job in ('reminders', 'close_rolls', 'purge')),
  last_run_at timestamptz not null,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 60),
  successes bigint not null default 0,
  failures bigint not null default 0
);
alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;
revoke all on public.job_runs from public, anon, authenticated;

create table public.platform_counters (
  day date not null,
  metric text not null check (metric in ('mail_sent', 'mail_failed', 'push_sent', 'push_failed', 'push_gone')),
  n bigint not null default 0,
  primary key (day, metric)
);
alter table public.platform_counters enable row level security;
alter table public.platform_counters force row level security;
revoke all on public.platform_counters from public, anon, authenticated;

-- Écriture (serveur seulement).
create function app_private.job_record(p_job text, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_runs (job, last_run_at, last_success_at, last_failure_at, last_error, successes, failures)
  values (p_job, now(), case when p_ok then now() end, case when not p_ok then now() end, case when not p_ok then left(p_error, 60) end,
          case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end)
  on conflict (job) do update set
    last_run_at = now(),
    last_success_at = case when p_ok then now() else public.job_runs.last_success_at end,
    last_failure_at = case when not p_ok then now() else public.job_runs.last_failure_at end,
    last_error = case when p_ok then null else left(p_error, 60) end,
    successes = public.job_runs.successes + case when p_ok then 1 else 0 end,
    failures = public.job_runs.failures + case when p_ok then 0 else 1 end;
end
$$;

create function app_private.counter_add(p_metric text, p_n integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_n is null or p_n <= 0 then
    return;
  end if;
  insert into public.platform_counters (day, metric, n) values (current_date, p_metric, p_n)
  on conflict (day, metric) do update set n = public.platform_counters.n + excluded.n;
end
$$;

-- Rétention : 13 mois, comme l'usage (appelée par la purge quotidienne).
create function app_private.purge_platform_counters() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  delete from public.platform_counters where day < current_date - 400;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function app_private.job_record(text, boolean, text) from public, anon, authenticated;
revoke all on function app_private.counter_add(text, integer) from public, anon, authenticated;
revoke all on function app_private.purge_platform_counters() from public, anon, authenticated;
grant execute on function app_private.job_record(text, boolean, text) to app_server;
grant execute on function app_private.counter_add(text, integer) to app_server;
grant execute on function app_private.purge_platform_counters() to app_server;

-- Lecture (administrateur de la plateforme seulement).
create function public.admin_job_runs() returns table (
  job text, last_run_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz, last_error text, successes bigint, failures bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query select j.job, j.last_run_at, j.last_success_at, j.last_failure_at, j.last_error, j.successes, j.failures
               from public.job_runs j order by j.job;
end
$$;

create function public.admin_counters() returns table (metric text, n7 bigint, n30 bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    select m.metric,
           coalesce(sum(c.n) filter (where c.day > current_date - 7), 0)::bigint,
           coalesce(sum(c.n) filter (where c.day > current_date - 30), 0)::bigint
    from (values ('mail_sent'), ('mail_failed'), ('push_sent'), ('push_failed'), ('push_gone')) as m (metric)
    left join public.platform_counters c on c.metric = m.metric
    group by m.metric order by m.metric;
end
$$;

revoke all on function public.admin_job_runs() from public, anon;
revoke all on function public.admin_counters() from public, anon;
grant execute on function public.admin_job_runs() to authenticated;
grant execute on function public.admin_counters() to authenticated;
