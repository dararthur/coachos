import "server-only";
import type { Tx } from "@/server/db/client";
import type { Role } from "@/domain/roles";

export interface AcademyListItem {
  id: string;
  name: string;
  role: Role;
}

export async function listAcademiesForUser(tx: Tx, userId: string): Promise<AcademyListItem[]> {
  const rows = await tx<{ id: string; name: string; role: Role }[]>`
    select a.id, a.name, m.role
    from public.academy_memberships m join public.academies a on a.id = m.academy_id
    where m.user_id = ${userId}
    order by a.name`;
  return [...rows];
}

export async function createAcademy(tx: Tx, input: { name: string; timezone: string; currency: string }): Promise<string> {
  const [row] = await tx<{ id: string }[]>`select public.create_academy(${input.name}, ${input.timezone}, ${input.currency}) as id`;
  return row!.id;
}

export async function updateAcademy(
  tx: Tx,
  academyId: string,
  input: { name: string; timezone: string; currency: string; retentionMonths: number },
): Promise<boolean> {
  const res = await tx`
    update public.academies
    set name = ${input.name}, timezone = ${input.timezone}, currency = ${input.currency}, retention_months = ${input.retentionMonths}
    where id = ${academyId}`;
  return res.count === 1;
}

export async function deleteAcademy(tx: Tx, academyId: string, confirmName: string): Promise<void> {
  await tx`select public.delete_academy(${academyId}, ${confirmName})`;
}

// --- Catalogue : disciplines et types de cours ------------------------------------------------
export interface Discipline {
  id: string;
  name: string;
  archivedAt: Date | null;
}
export interface ClassType {
  id: string;
  disciplineId: string;
  disciplineName: string;
  name: string;
  durationMinutes: number;
  capacity: number | null;
  archivedAt: Date | null;
}

export async function listDisciplines(tx: Tx, academyId: string): Promise<Discipline[]> {
  return tx<Discipline[]>`
    select id, name, archived_at as "archivedAt" from public.disciplines
    where academy_id = ${academyId} order by archived_at is not null, lower(name)`;
}

export async function listClassTypes(tx: Tx, academyId: string, opts: { includeArchived?: boolean } = {}): Promise<ClassType[]> {
  return tx<ClassType[]>`
    select ct.id, ct.discipline_id as "disciplineId", d.name as "disciplineName", ct.name,
           ct.default_duration_minutes as "durationMinutes", ct.default_capacity as capacity, ct.archived_at as "archivedAt"
    from public.class_types ct
    join public.disciplines d on d.id = ct.discipline_id and d.academy_id = ct.academy_id
    where ct.academy_id = ${academyId} ${opts.includeArchived ? tx`` : tx`and ct.archived_at is null and d.archived_at is null`}
    order by ct.archived_at is not null, lower(d.name), lower(ct.name)`;
}

export async function createDiscipline(tx: Tx, academyId: string, name: string): Promise<void> {
  await tx`insert into public.disciplines (academy_id, name) values (${academyId}, ${name})`;
}

export async function renameDiscipline(tx: Tx, academyId: string, id: string, name: string): Promise<boolean> {
  const r = await tx`update public.disciplines set name = ${name} where id = ${id} and academy_id = ${academyId}`;
  return r.count === 1;
}

export async function setDisciplineArchived(tx: Tx, academyId: string, id: string, archived: boolean): Promise<boolean> {
  const r = await tx`update public.disciplines set archived_at = ${archived ? new Date() : null} where id = ${id} and academy_id = ${academyId}`;
  return r.count === 1;
}

export async function createClassType(
  tx: Tx,
  academyId: string,
  input: { disciplineId: string; name: string; durationMinutes: number; capacity: number | null },
): Promise<void> {
  await tx`
    insert into public.class_types (academy_id, discipline_id, name, default_duration_minutes, default_capacity)
    values (${academyId}, ${input.disciplineId}, ${input.name}, ${input.durationMinutes}, ${input.capacity})`;
}

export async function setClassTypeArchived(tx: Tx, academyId: string, id: string, archived: boolean): Promise<boolean> {
  const r = await tx`update public.class_types set archived_at = ${archived ? new Date() : null} where id = ${id} and academy_id = ${academyId}`;
  return r.count === 1;
}
