import "server-only";
import type { Tx } from "@/server/db/client";

export interface DashboardStats {
  activeMembers: number;
  archivedMembers: number;
  sessionsToday: number;
  sessionsThisWeek: number;
  attendedThisWeek: number;
  avgPerSession30d: number | null;
  /** Membres actifs inscrits depuis plus de 30 jours sans aucune présence (présent/en retard) sur 30 jours. */
  inactive30: number;
  pastSessionsWithoutAttendance: number;
  weekly: { weekStart: string; attended: number }[];
}

/**
 * Indicateurs calculés en direct dans le fuseau de l'académie (jour et semaine ISO locaux).
 */
export async function getDashboardStats(tx: Tx, academyId: string, timezone: string): Promise<DashboardStats> {
  const [row] = await tx<Omit<DashboardStats, "weekly">[]>`
    with bounds as (
      select (date_trunc('day', now() at time zone ${timezone})) at time zone ${timezone} as day_start,
             (date_trunc('week', now() at time zone ${timezone})) at time zone ${timezone} as week_start
    )
    select
      (select count(*)::int from public.people where academy_id = ${academyId} and archived_at is null and anonymized_at is null) as "activeMembers",
      (select count(*)::int from public.people where academy_id = ${academyId} and archived_at is not null and anonymized_at is null) as "archivedMembers",
      (select count(*)::int from public.sessions s, bounds b where s.academy_id = ${academyId} and s.status = 'scheduled'
         and s.starts_at >= b.day_start and s.starts_at < b.day_start + interval '1 day') as "sessionsToday",
      (select count(*)::int from public.sessions s, bounds b where s.academy_id = ${academyId} and s.status = 'scheduled'
         and s.starts_at >= b.week_start and s.starts_at < b.week_start + interval '7 days') as "sessionsThisWeek",
      (select count(*)::int from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id, bounds b
         where a.academy_id = ${academyId} and a.status in ('present', 'late')
           and s.starts_at >= b.week_start and s.starts_at < b.week_start + interval '7 days') as "attendedThisWeek",
      (select round(avg(c)::numeric, 1)::float8 from (
         select count(*) filter (where a.status in ('present', 'late')) as c
         from public.sessions s left join public.attendance a on a.session_id = s.id and a.academy_id = s.academy_id
         where s.academy_id = ${academyId} and s.status = 'scheduled'
           and s.starts_at >= now() - interval '30 days' and s.starts_at < now()
           and exists (select 1 from public.attendance x where x.session_id = s.id)
         group by s.id) t) as "avgPerSession30d",
      (select count(*)::int from public.people p where p.academy_id = ${academyId} and p.archived_at is null and p.anonymized_at is null
         and coalesce(p.joined_on::timestamp at time zone ${timezone}, p.created_at) < now() - interval '30 days'
         and not exists (select 1 from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
                         where a.person_id = p.id and a.status in ('present', 'late') and s.starts_at >= now() - interval '30 days')) as inactive30,
      (select count(*)::int from public.sessions s where s.academy_id = ${academyId} and s.status = 'scheduled'
         and s.ends_at < now() and s.ends_at >= now() - interval '14 days'
         and not exists (select 1 from public.attendance a where a.session_id = s.id)) as "pastSessionsWithoutAttendance"`;

  const weekly = await tx<{ weekStart: string; attended: number }[]>`
    with weeks as (
      select generate_series(
        date_trunc('week', now() at time zone ${timezone}) - interval '7 weeks',
        date_trunc('week', now() at time zone ${timezone}), interval '1 week') as w
    )
    select to_char(w.w, 'YYYY-MM-DD') as "weekStart",
           (select count(*)::int from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
             where a.academy_id = ${academyId} and a.status in ('present', 'late')
               and s.starts_at >= w.w at time zone ${timezone} and s.starts_at < (w.w + interval '7 days') at time zone ${timezone}) as attended
    from weeks w order by w.w`;

  return { ...row!, weekly: [...weekly] };
}

export interface InactiveMember {
  id: string;
  firstName: string;
  lastName: string;
  lastAttendedAt: Date | null;
}

export async function listInactiveMembers(tx: Tx, academyId: string, timezone: string, limit = 8): Promise<InactiveMember[]> {
  return tx<InactiveMember[]>`
    select p.id, p.first_name as "firstName", p.last_name as "lastName",
      (select max(s.starts_at) from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
        where a.person_id = p.id and a.status in ('present', 'late')) as "lastAttendedAt"
    from public.people p
    where p.academy_id = ${academyId} and p.archived_at is null and p.anonymized_at is null
      and coalesce(p.joined_on::timestamp at time zone ${timezone}, p.created_at) < now() - interval '30 days'
      and not exists (select 1 from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
                      where a.person_id = p.id and a.status in ('present', 'late') and s.starts_at >= now() - interval '30 days')
    order by "lastAttendedAt" desc nulls last, lower(p.last_name)
    limit ${limit}`;
}
