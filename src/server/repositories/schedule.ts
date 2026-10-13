import "server-only";
import type { Tx } from "@/server/db/client";

export interface SessionRow {
  id: string;
  classTypeId: string;
  classTypeName: string;
  disciplineName: string;
  instructorId: string | null;
  instructorName: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  status: "scheduled" | "cancelled";
  notes: string | null;
  recorded: number;
  attended: number;
}

const SESSION_COLUMNS = (tx: Tx) => tx`
  s.id, s.class_type_id as "classTypeId", ct.name as "classTypeName", d.name as "disciplineName",
  s.instructor_id as "instructorId", coalesce(nullif(pr.display_name, ''), pr.email) as "instructorName",
  s.starts_at as "startsAt", s.ends_at as "endsAt", s.capacity, s.status, s.notes,
  (select count(*)::int from public.attendance a where a.session_id = s.id and a.academy_id = s.academy_id) as recorded,
  (select count(*)::int from public.attendance a where a.session_id = s.id and a.academy_id = s.academy_id and a.status in ('present', 'late')) as attended`;

const SESSION_FROM = (tx: Tx) => tx`
  from public.sessions s
  join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
  join public.disciplines d on d.id = ct.discipline_id and d.academy_id = ct.academy_id
  left join public.profiles pr on pr.id = s.instructor_id`;

/** Séances dont la date locale (fuseau de l'académie) est comprise entre `from` et `to` inclus. */
export async function listSessions(
  tx: Tx,
  academyId: string,
  timezone: string,
  range: { from: string; to: string },
  opts: { instructorId?: string | null; onlyMissingAttendance?: boolean } = {},
): Promise<SessionRow[]> {
  const rows = await tx<SessionRow[]>`
    select ${SESSION_COLUMNS(tx)} ${SESSION_FROM(tx)}
    where s.academy_id = ${academyId}
      and s.starts_at >= (${range.from}::date)::timestamp at time zone ${timezone}
      and s.starts_at < ((${range.to}::date) + 1)::timestamp at time zone ${timezone}
      ${opts.instructorId ? tx`and s.instructor_id = ${opts.instructorId}` : tx``}
      ${opts.onlyMissingAttendance ? tx`and s.status = 'scheduled' and not exists (select 1 from public.attendance a where a.session_id = s.id)` : tx``}
    order by s.starts_at, s.id`;
  return [...rows];
}

export async function getSession(tx: Tx, academyId: string, sessionId: string): Promise<SessionRow | null> {
  const rows = await tx<SessionRow[]>`
    select ${SESSION_COLUMNS(tx)} ${SESSION_FROM(tx)}
    where s.academy_id = ${academyId} and s.id = ${sessionId}`;
  return rows[0] ?? null;
}

export interface NewSessions {
  classTypeId: string;
  instructorId: string | null;
  /** Dates locales YYYY-MM-DD. */
  dates: string[];
  /** Heure locale HH:MM. */
  time: string;
  durationMinutes: number;
  capacity: number | null;
  notes: string | null;
}

/** Crée les séances en convertissant (date + heure) dans le fuseau de l'académie. Ignore les créneaux déjà existants. */
export async function createSessions(tx: Tx, academyId: string, input: NewSessions): Promise<{ created: number; skipped: number }> {
  const seriesId = input.dates.length > 1 ? crypto.randomUUID() : null;
  const payload = input.dates.map((date) => ({ date, time: input.time }));
  const inserted = await tx`
    insert into public.sessions (academy_id, class_type_id, instructor_id, starts_at, ends_at, capacity, notes, series_id)
    select a.id, ${input.classTypeId}::uuid, ${input.instructorId}::uuid,
           (d.date + d.time) at time zone a.timezone,
           (d.date + d.time) at time zone a.timezone + make_interval(mins => ${input.durationMinutes}::int),
           ${input.capacity}::int, ${input.notes}::text, ${seriesId}::uuid
    from public.academies a, jsonb_to_recordset(${tx.json(payload)}::jsonb) as d(date date, time time)
    where a.id = ${academyId}
    on conflict do nothing
    returning id`;
  return { created: inserted.length, skipped: input.dates.length - inserted.length };
}

export async function updateSession(
  tx: Tx,
  academyId: string,
  sessionId: string,
  input: { instructorId: string | null; date: string; time: string; durationMinutes: number; capacity: number | null; notes: string | null },
): Promise<boolean> {
  const r = await tx`
    update public.sessions s
    set instructor_id = ${input.instructorId}::uuid,
        starts_at = (${input.date}::date + ${input.time}::time) at time zone a.timezone,
        ends_at = (${input.date}::date + ${input.time}::time) at time zone a.timezone + make_interval(mins => ${input.durationMinutes}::int),
        capacity = ${input.capacity}::int, notes = ${input.notes}::text
    from public.academies a
    where s.id = ${sessionId} and s.academy_id = ${academyId} and a.id = s.academy_id`;
  return r.count === 1;
}

export async function setSessionStatus(tx: Tx, academyId: string, sessionId: string, status: "scheduled" | "cancelled"): Promise<boolean> {
  const r = await tx`update public.sessions set status = ${status} where id = ${sessionId} and academy_id = ${academyId}`;
  return r.count === 1;
}

export async function deleteSession(tx: Tx, academyId: string, sessionId: string): Promise<boolean> {
  const r = await tx`delete from public.sessions where id = ${sessionId} and academy_id = ${academyId}`;
  return r.count === 1;
}

export interface InstructorOption {
  id: string;
  name: string;
}

export async function listInstructors(tx: Tx, academyId: string): Promise<InstructorOption[]> {
  return tx<InstructorOption[]>`
    select m.user_id as id, coalesce(nullif(p.display_name, ''), p.email, 'Coach') as name
    from public.academy_memberships m join public.profiles p on p.id = m.user_id
    where m.academy_id = ${academyId} and m.role in ('owner', 'admin', 'coach')
    order by lower(coalesce(nullif(p.display_name, ''), p.email))`;
}
