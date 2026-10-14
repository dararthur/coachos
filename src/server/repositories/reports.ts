import "server-only";
import type { Tx } from "@/server/db/client";
import type { AttendanceStatus } from "@/domain/validation";

export interface ReportFilters {
  from: string;
  to: string;
  classTypeId?: string;
  personId?: string;
}

export interface AttendanceReportRow {
  attendanceId: string;
  startsAt: Date;
  classTypeName: string;
  disciplineName: string;
  personId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus;
  anonymized: boolean;
}

export const REPORT_PAGE_SIZE = 50;
export const EXPORT_MAX_ROWS = 50_000;

function where(tx: Tx, academyId: string, timezone: string, f: ReportFilters) {
  return tx`
    a.academy_id = ${academyId}
    and s.starts_at >= (${f.from}::date)::timestamp at time zone ${timezone}
    and s.starts_at < ((${f.to}::date) + 1)::timestamp at time zone ${timezone}
    ${f.classTypeId ? tx`and s.class_type_id = ${f.classTypeId}` : tx``}
    ${f.personId ? tx`and a.person_id = ${f.personId}` : tx``}`;
}

const FROM = (tx: Tx) => tx`
  from public.attendance a
  join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
  join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
  join public.disciplines d on d.id = ct.discipline_id and d.academy_id = ct.academy_id
  join public.people p on p.id = a.person_id and p.academy_id = a.academy_id`;

export async function attendanceReport(
  tx: Tx,
  academyId: string,
  timezone: string,
  filters: ReportFilters,
  page: number,
): Promise<{ rows: AttendanceReportRow[]; total: number; summary: { present: number; late: number; absent: number; distinctMembers: number } }> {
  const [agg] = await tx<{ total: number; present: number; late: number; absent: number; distinctMembers: number }[]>`
    select count(*)::int as total,
           count(*) filter (where a.status = 'present')::int as present,
           count(*) filter (where a.status = 'late')::int as late,
           count(*) filter (where a.status = 'absent')::int as absent,
           count(distinct a.person_id)::int as "distinctMembers"
    ${FROM(tx)} where ${where(tx, academyId, timezone, filters)}`;
  const rows = await tx<AttendanceReportRow[]>`
    select a.id as "attendanceId", s.starts_at as "startsAt", ct.name as "classTypeName", d.name as "disciplineName",
           p.id as "personId", p.first_name as "firstName", p.last_name as "lastName", a.status, (p.anonymized_at is not null) as anonymized
    ${FROM(tx)} where ${where(tx, academyId, timezone, filters)}
    order by s.starts_at desc, lower(p.last_name), p.id
    limit ${REPORT_PAGE_SIZE} offset ${(Math.max(1, page) - 1) * REPORT_PAGE_SIZE}`;
  return {
    rows: [...rows],
    total: agg?.total ?? 0,
    summary: {
      present: agg?.present ?? 0,
      late: agg?.late ?? 0,
      absent: agg?.absent ?? 0,
      distinctMembers: agg?.distinctMembers ?? 0,
    },
  };
}

export async function attendanceForExport(tx: Tx, academyId: string, timezone: string, filters: ReportFilters): Promise<AttendanceReportRow[]> {
  const rows = await tx<AttendanceReportRow[]>`
    select a.id as "attendanceId", s.starts_at as "startsAt", ct.name as "classTypeName", d.name as "disciplineName",
           p.id as "personId", p.first_name as "firstName", p.last_name as "lastName", a.status, (p.anonymized_at is not null) as anonymized
    ${FROM(tx)} where ${where(tx, academyId, timezone, filters)}
    order by s.starts_at, lower(p.last_name), p.id
    limit ${EXPORT_MAX_ROWS}`;
  return [...rows];
}

export interface MemberCountRow {
  personId: string;
  firstName: string;
  lastName: string;
  present: number;
  late: number;
  absent: number;
}

/**
 * Nombre de présences de CHAQUE membre actif du club sur la période (bornes incluses, dans le fuseau du club), du plus assidu au moins assidu.
 * « Présences » compte les présents ET les retards ; les membres sans aucune présence figurent avec 0. Fiches archivées et anonymisées exclues.
 */
export async function attendanceCountsForExport(tx: Tx, academyId: string, timezone: string, f: { from: string; to: string; classTypeId?: string }): Promise<MemberCountRow[]> {
  const rows = await tx<MemberCountRow[]>`
    select p.id as "personId", p.first_name as "firstName", p.last_name as "lastName",
           count(x.id) filter (where x.status in ('present', 'late'))::int as present,
           count(x.id) filter (where x.status = 'late')::int as late,
           count(x.id) filter (where x.status = 'absent')::int as absent
    from public.people p
    left join lateral (
      select a.id, a.status
      from public.attendance a
      join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
      where a.person_id = p.id and a.academy_id = p.academy_id
        and s.starts_at >= (${f.from}::date)::timestamp at time zone ${timezone}
        and s.starts_at < ((${f.to}::date) + 1)::timestamp at time zone ${timezone}
        ${f.classTypeId ? tx`and s.class_type_id = ${f.classTypeId}` : tx``}
    ) x on true
    where p.academy_id = ${academyId} and p.archived_at is null and p.anonymized_at is null
    group by p.id
    order by present desc, lower(p.last_name), lower(p.first_name), p.id
    limit ${EXPORT_MAX_ROWS}`;
  return [...rows];
}
