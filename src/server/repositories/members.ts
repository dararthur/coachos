import "server-only";
import type { Tx } from "@/server/db/client";
import type { ExistingKeys, ImportRow } from "@/domain/csv-import";
import { nameKey } from "@/domain/csv-import";
import type { AvatarStyle, Belt } from "@/domain/profile";

export interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  joinedOn: string | null;
  externalRef: string | null;
  archivedAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  lastAttendedAt: Date | null;
  belt: Belt | null;
  beltStripes: number;
  avatarStyle: AvatarStyle;
  hasPhoto: boolean;
  /** Présent seulement si listPeople reçoit `assiduityTimezone` (lundis AAAA-MM-JJ des semaines avec une venue). */
  attendedWeeks?: string[];
}

export type MemberStatus = "active" | "archived" | "all";
export const PAGE_SIZE = 25;

/** Échappe les jokers LIKE pour que la recherche reste littérale. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listPeople(
  tx: Tx,
  academyId: string,
  /** `assiduityTimezone` : ajoute `attendedWeeks` (lundis, dans ce fuseau, des semaines avec une venue sur ~9 semaines). */
  opts: { q?: string; status: MemberStatus; page: number; assiduityTimezone?: string },
): Promise<{ rows: PersonRow[]; total: number }> {
  const pattern = opts.q ? `%${escapeLike(opts.q.trim().toLowerCase())}%` : null;
  const search = pattern
    ? tx`and (lower(p.first_name || ' ' || p.last_name) like ${pattern} escape '\\' or lower(p.last_name || ' ' || p.first_name) like ${pattern} escape '\\' or lower(coalesce(p.email, '')) like ${pattern} escape '\\')`
    : tx``;
  const status =
    opts.status === "active" ? tx`and p.archived_at is null` : opts.status === "archived" ? tx`and p.archived_at is not null` : tx``;
  // Semaines (lundi local, ISO) avec au moins une venue : 63 jours couvrent les 8 semaines affichées, même en début de semaine.
  const weeks = opts.assiduityTimezone
    ? tx`, array(select distinct to_char(date_trunc('week', s.starts_at at time zone ${opts.assiduityTimezone}), 'YYYY-MM-DD')
               from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
               where a.person_id = p.id and a.academy_id = p.academy_id and a.status in ('present', 'late')
                 and s.starts_at >= now() - interval '63 days') as "attendedWeeks"`
    : tx``;
  const [{ total }] = await tx<[{ total: number }]>`
    select count(*)::int as total from public.people p where p.academy_id = ${academyId} ${status} ${search}`;
  const rows = await tx<PersonRow[]>`
    select p.id, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone, p.joined_on as "joinedOn",
           p.external_ref as "externalRef", p.archived_at as "archivedAt", p.anonymized_at as "anonymizedAt", p.created_at as "createdAt",
           p.belt, p.belt_stripes as "beltStripes", p.avatar_style as "avatarStyle",
           exists (select 1 from public.person_photos ph where ph.person_id = p.id) as "hasPhoto",
           (select max(s.starts_at) from public.attendance a join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
             where a.person_id = p.id and a.academy_id = p.academy_id and a.status in ('present', 'late')) as "lastAttendedAt"
           ${weeks}
    from public.people p
    where p.academy_id = ${academyId} ${status} ${search}
    order by lower(p.last_name), lower(p.first_name), p.id
    limit ${PAGE_SIZE} offset ${(Math.max(1, opts.page) - 1) * PAGE_SIZE}`;
  return { rows: [...rows], total };
}

export async function getPerson(tx: Tx, academyId: string, personId: string): Promise<PersonRow | null> {
  const rows = await tx<PersonRow[]>`
    select p.id, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone, p.joined_on as "joinedOn",
           p.external_ref as "externalRef", p.archived_at as "archivedAt", p.anonymized_at as "anonymizedAt", p.created_at as "createdAt",
           p.belt, p.belt_stripes as "beltStripes", p.avatar_style as "avatarStyle",
           exists (select 1 from public.person_photos ph where ph.person_id = p.id) as "hasPhoto",
           null::timestamptz as "lastAttendedAt"
    from public.people p where p.id = ${personId} and p.academy_id = ${academyId}`;
  return rows[0] ?? null;
}

export interface PersonInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  joinedOn: string | null;
}

export async function createPerson(tx: Tx, academyId: string, input: PersonInput): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.people (academy_id, first_name, last_name, email, phone, joined_on)
    values (${academyId}, ${input.firstName}, ${input.lastName}, ${input.email}, ${input.phone}, ${input.joinedOn})
    returning id`;
  return row!.id;
}

export async function updatePerson(tx: Tx, academyId: string, personId: string, input: PersonInput): Promise<boolean> {
  const r = await tx`
    update public.people set first_name = ${input.firstName}, last_name = ${input.lastName}, email = ${input.email}, phone = ${input.phone}, joined_on = ${input.joinedOn}
    where id = ${personId} and academy_id = ${academyId} and anonymized_at is null`;
  return r.count === 1;
}

export async function setPersonArchived(tx: Tx, academyId: string, personId: string, archived: boolean): Promise<boolean> {
  const r = await tx`
    update public.people set archived_at = ${archived ? new Date() : null}
    where id = ${personId} and academy_id = ${academyId} and anonymized_at is null`;
  return r.count === 1;
}

export async function erasePerson(tx: Tx, personId: string, mode: "anonymize" | "delete"): Promise<void> {
  await tx`select public.erase_person(${personId}, ${mode})`;
}

export async function exportPersonData(tx: Tx, personId: string): Promise<unknown> {
  const [row] = await tx<{ data: unknown }[]>`select public.export_person_data(${personId}) as data`;
  return row?.data;
}

/** Clés déjà présentes parmi celles du fichier (requêtes ciblées : on ne charge pas tout l'annuaire). */
export async function findExistingKeys(tx: Tx, academyId: string, rows: readonly ImportRow[]): Promise<ExistingKeys> {
  const emails = rows.flatMap((r) => (r.email ? [r.email] : []));
  const refs = rows.flatMap((r) => (r.externalRef ? [r.externalRef] : []));
  const names = rows.map((r) => nameKey(r.firstName, r.lastName));
  if (rows.length === 0) return { emails: new Set(), externalRefs: new Set(), names: new Set() };
  const found = await tx<{ email: string | null; external_ref: string | null; name: string }[]>`
    select lower(email) as email, external_ref, lower(first_name || ' ' || last_name) as name
    from public.people
    where academy_id = ${academyId} and anonymized_at is null
      and (lower(email) = any(${emails}::text[]) or external_ref = any(${refs}::text[]) or lower(first_name || ' ' || last_name) = any(${names}::text[]))`;
  return {
    emails: new Set(found.flatMap((f) => (f.email ? [f.email] : []))),
    externalRefs: new Set(found.flatMap((f) => (f.external_ref ? [f.external_ref] : []))),
    names: new Set(found.map((f) => f.name)),
  };
}

/** Insertion en lot ; un conflit d'unicité (course entre deux imports) ignore la ligne au lieu de tout annuler. */
export async function insertImported(tx: Tx, academyId: string, rows: readonly ImportRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({
    first_name: r.firstName,
    last_name: r.lastName,
    email: r.email,
    phone: r.phone,
    joined_on: r.joinedOn,
    external_ref: r.externalRef,
  }));
  const inserted = await tx`
    insert into public.people (academy_id, first_name, last_name, email, phone, joined_on, external_ref)
    select ${academyId}::uuid, d.first_name, d.last_name, d.email, d.phone, d.joined_on, d.external_ref
    from jsonb_to_recordset(${tx.json(payload)}::jsonb) as d(first_name text, last_name text, email text, phone text, joined_on date, external_ref text)
    on conflict do nothing
    returning id`;
  return inserted.length;
}

export async function recordEvent(tx: Tx, academyId: string, action: "members.imported" | "members.exported" | "attendance.exported", metadata: Record<string, number>) {
  await tx`select public.record_event(${academyId}, ${action}, ${tx.json(metadata)})`;
}

export async function listAllForExport(tx: Tx, academyId: string): Promise<PersonRow[]> {
  const rows = await tx<PersonRow[]>`
    select p.id, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone, p.joined_on as "joinedOn",
           p.external_ref as "externalRef", p.archived_at as "archivedAt", p.anonymized_at as "anonymizedAt", p.created_at as "createdAt",
           p.belt, p.belt_stripes as "beltStripes", p.avatar_style as "avatarStyle",
           exists (select 1 from public.person_photos ph where ph.person_id = p.id) as "hasPhoto",
           null::timestamptz as "lastAttendedAt"
    from public.people p where p.academy_id = ${academyId} and p.anonymized_at is null
    order by lower(p.last_name), lower(p.first_name) limit 20000`;
  return [...rows];
}
