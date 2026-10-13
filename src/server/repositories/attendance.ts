import "server-only";
import type { Tx } from "@/server/db/client";
import type { AttendanceStatus } from "@/domain/validation";

export interface RosterEntry {
  personId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus | null;
  archived: boolean;
}

/**
 * Feuille d'appel : membres actifs + tout membre (même archivé) ayant déjà une présence enregistrée sur la séance.
 */
export async function getRoster(tx: Tx, academyId: string, sessionId: string): Promise<RosterEntry[]> {
  const rows = await tx<RosterEntry[]>`
    select p.id as "personId", p.first_name as "firstName", p.last_name as "lastName", a.status,
           (p.archived_at is not null) as archived
    from public.people p
    left join public.attendance a on a.person_id = p.id and a.academy_id = p.academy_id and a.session_id = ${sessionId}
    where p.academy_id = ${academyId} and p.anonymized_at is null
      and (p.archived_at is null or a.id is not null)
    order by lower(p.last_name), lower(p.first_name), p.id`;
  return [...rows];
}

/** Enregistre, modifie ou efface (status = null) une présence. Retourne false si la séance/le membre n'existe pas ici. */
export async function setAttendance(
  tx: Tx,
  academyId: string,
  sessionId: string,
  personId: string,
  status: AttendanceStatus | null,
): Promise<boolean> {
  if (status === null) {
    await tx`delete from public.attendance where academy_id = ${academyId} and session_id = ${sessionId} and person_id = ${personId}`;
    return true;
  }
  const rows = await tx`
    insert into public.attendance (academy_id, session_id, person_id, status)
    select ${academyId}::uuid, s.id, p.id, ${status}::text
    from public.sessions s, public.people p
    where s.id = ${sessionId} and s.academy_id = ${academyId} and p.id = ${personId} and p.academy_id = ${academyId}
    on conflict (session_id, person_id) do update set status = excluded.status
    returning id`;
  return rows.length === 1;
}

/** Marque « présent » tous les membres actifs sans enregistrement (raccourci de fin de cours). */
export async function markRemainingPresent(tx: Tx, academyId: string, sessionId: string): Promise<number> {
  const rows = await tx`
    insert into public.attendance (academy_id, session_id, person_id, status)
    select ${academyId}::uuid, ${sessionId}::uuid, p.id, 'present'
    from public.people p
    where p.academy_id = ${academyId} and p.archived_at is null and p.anonymized_at is null
      and not exists (select 1 from public.attendance a where a.session_id = ${sessionId} and a.person_id = p.id)
    on conflict do nothing
    returning id`;
  return rows.length;
}

export interface PersonAttendanceRow {
  sessionId: string;
  startsAt: Date;
  classTypeName: string;
  status: AttendanceStatus;
  sessionStatus: string;
}

export async function personHistory(tx: Tx, academyId: string, personId: string, limit = 200): Promise<PersonAttendanceRow[]> {
  return tx<PersonAttendanceRow[]>`
    select s.id as "sessionId", s.starts_at as "startsAt", ct.name as "classTypeName", a.status, s.status as "sessionStatus"
    from public.attendance a
    join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
    join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
    where a.academy_id = ${academyId} and a.person_id = ${personId}
    order by s.starts_at desc limit ${limit}`;
}

export async function personTotals(
  tx: Tx,
  academyId: string,
  personId: string,
): Promise<{ attended: number; absent: number; last30: number }> {
  const [row] = await tx<{ attended: number; absent: number; last30: number }[]>`
    select count(*) filter (where a.status in ('present', 'late'))::int as attended,
           count(*) filter (where a.status = 'absent')::int as absent,
           count(*) filter (where a.status in ('present', 'late') and s.starts_at >= now() - interval '30 days')::int as last30
    from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
    where a.academy_id = ${academyId} and a.person_id = ${personId}`;
  return row ?? { attended: 0, absent: 0, last30: 0 };
}
