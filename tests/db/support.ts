import postgres from "postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { createTestClient, withUser, type Sql, type Tx } from "@/server/db/client";

let admin: Sql | undefined;
let app: Sql | undefined;

/** Connexion superutilisateur : uniquement pour préparer des fixtures et inspecter l'état réel. */
export function adminSql(): Sql {
  admin ??= postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
  return admin;
}

/** Connexion `app_server`, comme en production. */
export function appSql(): Sql {
  app ??= createTestClient(process.env.TEST_APP_DATABASE_URL!);
  return app;
}

export async function closeAll() {
  await admin?.end();
  await app?.end();
  admin = undefined;
  app = undefined;
}

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(label: string, confirmed = true): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.invalid`;
  const [row] = await adminSql()<{ id: string }[]>`
    insert into auth.users (name, email, email_verified)
    values (${label}, ${email}, ${confirmed})
    returning id`;
  return { id: row!.id, email };
}

export function asUser<T>(user: TestUser | { id: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUser({ id: user.id, email: "email" in user ? user.email : undefined }, fn, appSql());
}

export async function createAcademy(owner: TestUser, name = "Club test"): Promise<string> {
  return asUser(owner, async (tx) => {
    const [row] = await tx<{ id: string }[]>`select public.create_academy(${name}, 'Europe/Paris', 'EUR') as id`;
    return row!.id;
  });
}

export async function addMember(academyId: string, user: TestUser, role: "admin" | "coach" | "member") {
  await adminSql()`insert into public.academy_memberships (academy_id, user_id, role) values (${academyId}, ${user.id}, ${role})`;
}

export async function createPerson(academyId: string, first = "Ana", last = "Test", extra: { email?: string; external?: string } = {}) {
  const [row] = await adminSql()<{ id: string }[]>`
    insert into public.people (academy_id, first_name, last_name, email, external_ref)
    values (${academyId}, ${first}, ${last}, ${extra.email ?? null}, ${extra.external ?? null}) returning id`;
  return row!.id;
}

export async function firstClassType(academyId: string): Promise<string> {
  const [row] = await adminSql()<{ id: string }[]>`select id from public.class_types where academy_id = ${academyId} limit 1`;
  return row!.id;
}

export async function createSession(
  academyId: string,
  opts: { startsAt?: string; instructor?: string | null; status?: "scheduled" | "cancelled" } = {},
): Promise<string> {
  const classType = await firstClassType(academyId);
  const start = opts.startsAt ?? new Date(Date.now() + 86_400_000).toISOString();
  const [row] = await adminSql()<{ id: string }[]>`
    insert into public.sessions (academy_id, class_type_id, instructor_id, starts_at, ends_at, status)
    values (${academyId}, ${classType}, ${opts.instructor ?? null}, ${start}::timestamptz,
            ${start}::timestamptz + interval '1 hour', ${opts.status ?? "scheduled"})
    returning id`;
  return row!.id;
}

/** Exécute une requête attendue en échec et retourne le message d'erreur Postgres brut. */
export async function failing(fn: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const src = err.cause ?? err;
    return { code: src.code ?? err.code, message: src.message ?? err.message ?? String(e) };
  }
  throw new Error("L'opération aurait dû échouer");
}

export interface World {
  alice: TestUser; // owner A
  carl: TestUser; // coach A
  mia: TestUser; // member A (liée à la fiche miaPerson)
  adam: TestUser; // admin A
  bob: TestUser; // owner B
  academyA: string;
  academyB: string;
  personA: string;
  miaPerson: string;
  personB: string;
  sessionA: string;
  sessionB: string;
  classTypeB: string;
}

/** Deux académies indépendantes avec des données dans chaque table tenant. */
export async function buildWorld(): Promise<World> {
  const [alice, carl, mia, adam, bob] = await Promise.all(["alice", "carl", "mia", "adam", "bob"].map((n) => createUser(n)));
  const academyA = await createAcademy(alice!, "Club A");
  const academyB = await createAcademy(bob!, "Club B");
  await addMember(academyA, carl!, "coach");
  await addMember(academyA, mia!, "member");
  await addMember(academyA, adam!, "admin");
  const personA = await createPerson(academyA, "Alba", "Alpha", { email: "alba@example.invalid" });
  const miaPerson = await createPerson(academyA, "Mia", "Member");
  await adminSql()`update public.people set user_id = ${mia!.id} where id = ${miaPerson}`;
  const personB = await createPerson(academyB, "Bea", "Beta", { email: "bea@example.invalid", external: "B-1" });
  const sessionA = await createSession(academyA, { instructor: carl!.id });
  const sessionB = await createSession(academyB, { instructor: null });
  await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academyA}, ${sessionA}, ${personA}, 'present')`;
  await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academyB}, ${sessionB}, ${personB}, 'present')`;
  await adminSql()`insert into public.invitations (academy_id, email, role, token_hash, expires_at)
    values (${academyB}, ${`invite-b-${randomUUID().slice(0, 6)}@example.invalid`}, 'coach', ${randomBytes(32).toString("hex")}, now() + interval '1 day')`;
  const classTypeB = await firstClassType(academyB);
  return { alice: alice!, carl: carl!, mia: mia!, adam: adam!, bob: bob!, academyA, academyB, personA, miaPerson, personB, sessionA, sessionB, classTypeB };
}
