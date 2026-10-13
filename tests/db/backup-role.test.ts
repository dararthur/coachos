import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, closeAll, createAcademy, createPerson, createUser, failing } from "./support";

/**
 * Privilèges du rôle de sauvegarde (ops/backup/create-backup-role.sql), prouvés sur un VRAI PostgreSQL au niveau SQL :
 * lecture complète de tous les clubs, aucune écriture, RLS inchangée, et nécessité de BYPASSRLS.
 * LIMITE : les binaires pg_dump / pg_restore ne sont pas disponibles ici (PostgreSQL embarqué) ; que `pg_dump` aille jusqu'au bout avec ce
 * rôle doit être vérifié sur une vraie instance (docs/operations.md §1.2). Ce test prouve les droits, pas l'outil.
 */
const script = readFileSync(path.resolve(import.meta.dirname, "../../ops/backup/create-backup-role.sql"), "utf8");
const TENANT_TABLES = ["public.academies", "public.people", "public.academy_memberships", "auth.users", "coachos_migrations.applied"];

async function countAs(role: string, table: string): Promise<number> {
  return adminSql().begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    const [r] = await tx.unsafe(`select count(*)::int as n from ${table}`);
    return r!.n as number;
  });
}

describe("rôle de sauvegarde : privilèges nécessaires, suffisants et minimaux", () => {
  let policiesBefore = 0;

  beforeAll(async () => {
    const admin = adminSql();
    const [p] = await admin`select count(*)::int as n from pg_policies`;
    policiesBefore = p!.n;
    await admin.unsafe(script);
    // Témoin négatif : mêmes droits de lecture, SANS BYPASSRLS.
    await admin.unsafe("create role coachos_backup_nobypass nologin nobypassrls; grant pg_read_all_data to coachos_backup_nobypass;");
    // Deux clubs et des données, pour que « tout lire » soit observable.
    const owner1 = await createUser("sauv-a");
    const owner2 = await createUser("sauv-b");
    const a1 = await createAcademy(owner1, "Club sauvegarde A");
    const a2 = await createAcademy(owner2, "Club sauvegarde B");
    await addMember(a1, await createUser("sauv-c"), "coach");
    await createPerson(a1, "Ana", "Un");
    await createPerson(a2, "Bea", "Deux");
  });

  afterAll(async () => {
    const admin = adminSql();
    await admin.unsafe("drop role if exists coachos_backup_nobypass; drop role if exists coachos_backup;");
    await closeAll();
  });

  it("attributs : lecture seule en pratique, aucun privilège d'administration, une seule connexion de sauvegarde à la fois (+1)", async () => {
    const [r] = await adminSql()`
      select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin, rolconnlimit, rolconfig
      from pg_roles where rolname = 'coachos_backup'`;
    expect(r).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: true, rolcanlogin: true, rolconnlimit: 2 });
    expect(r!.rolconfig).toContain("default_transaction_read_only=on");
  });

  it("lit TOUTES les lignes de TOUS les clubs et du suivi des migrations (sauvegarde complète)", async () => {
    for (const table of TENANT_TABLES) {
      const [expected] = await adminSql().unsafe(`select count(*)::int as n from ${table}`);
      const got = await countAs("coachos_backup", table);
      expect(got, table).toBe(expected!.n);
      expect(got, `${table} doit contenir des données pour que le test soit probant`).toBeGreaterThan(0);
    }
  });

  it("témoin négatif : sans BYPASSRLS, la même lecture est INCOMPLÈTE (c'est pourquoi pg_dump a besoin de BYPASSRLS)", async () => {
    const people = await countAs("coachos_backup_nobypass", "public.people");
    const all = await countAs("coachos_backup", "public.people");
    expect(all).toBeGreaterThan(0);
    expect(people).toBeLessThan(all);
  });

  it("n'écrit RIEN : ni insertion, ni modification, ni suppression, ni DDL, ni appel des fonctions d'écriture réservées", async () => {
    const attempts = [
      "insert into public.academies (name, timezone, currency) values ('x', 'Europe/Paris', 'EUR')",
      "update public.people set first_name = 'x'",
      "delete from public.people",
      "update coachos_migrations.applied set name = 'x'",
      "create table public.intrus (id int)",
      "truncate public.people",
    ];
    for (const sql of attempts) {
      const err = await failing(() =>
        adminSql().begin(async (tx) => {
          await tx.unsafe("set local role coachos_backup");
          await tx.unsafe(sql);
        }),
      );
      expect(err.message, sql).toMatch(/permission denied|read-only|must be owner|violates row-level/i);
    }
  });

  it("la RLS n'est ni désactivée ni modifiée par ce rôle : toutes les tables publiques la gardent, même nombre de politiques", async () => {
    const [off] = await adminSql()`select count(*)::int as n from pg_tables where schemaname = 'public' and not rowsecurity`;
    expect(off!.n).toBe(0);
    const [p] = await adminSql()`select count(*)::int as n from pg_policies`;
    expect(p!.n).toBe(policiesBefore);
  });

  it("n'obtient aucun droit sur les rôles applicatifs : n'est membre d'aucun de leurs groupes", async () => {
    const rows = await adminSql()`
      select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid
      where m.member = (select oid from pg_roles where rolname = 'coachos_backup')`;
    expect(rows.map((x) => x.rolname)).toEqual(["pg_read_all_data"]);
  });
});
