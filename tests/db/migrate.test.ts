import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclaration de types
import { COACHOS_ROLES, MigrationError, ROLE_MARKER, detectRoleCollisions, loadMigrations, planMigrations, readApplied, runMigrations } from "../../scripts/lib/migrate.mjs";
import { adminSql, closeAll } from "./support";

const migrationsDir = path.resolve(import.meta.dirname, "../../db/migrations");
const created: string[] = [];
const freshUrls = new Map<string, string>();
const urlOf = new Map<postgres.Sql, string>();
const dirs: string[] = [];
afterAll(async () => {
  for (const db of created) await adminSql().unsafe(`drop database if exists ${db} with (force)`);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  await closeAll();
});

async function freshDb(): Promise<postgres.Sql> {
  const name = `coachos_mig_${Math.random().toString(36).slice(2, 10)}`;
  await adminSql().unsafe(`create database ${name}`);
  created.push(name);
  const url = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
  url.pathname = `/${name}`;
  freshUrls.set(name, url.toString());
  const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
  urlOf.set(sql, url.toString());
  return sql;
}
function tempMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "coachos-migs-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}
const msg = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(MigrationError);
    return (e as Error).message;
  }
  throw new Error("aurait dû être refusé");
};

describe("lanceur de migrations : application, suivi, reprise", () => {
  it("applique les 12 migrations réelles dans l'ordre, avec suivi ; une relance n'applique rien ; le suivi est fermé aux rôles applicatifs", async () => {
    const sql = await freshDb();
    try {
      const first = await runMigrations({ sql, dir: migrationsDir });
      const files = loadMigrations(migrationsDir);
      expect(files).toHaveLength(12);
      expect(first.applied).toEqual(files.map((f: { name: string }) => f.name));
      const rows = await readApplied(sql);
      expect(rows.map((r: { version: string }) => r.version)).toEqual(files.map((f: { version: string }) => f.version));
      expect(rows.every((r: { checksum: string }, i: number) => r.checksum === files[i].checksum)).toBe(true);

      const again = await runMigrations({ sql, dir: migrationsDir });
      expect(again.pending).toEqual([]);
      expect((await readApplied(sql)).length).toBe(12);

      const [priv] = await sql`select has_schema_privilege('app_server', 'coachos_migrations', 'usage') as a, has_schema_privilege('auth_runtime', 'coachos_migrations', 'usage') as b,
        has_schema_privilege('authenticated', 'coachos_migrations', 'usage') as c, has_schema_privilege('anon', 'coachos_migrations', 'usage') as d`;
      expect(priv).toEqual({ a: false, b: false, c: false, d: false });
      const [tables] = await sql`select count(*)::int as n from pg_tables where schemaname = 'public' and not rowsecurity`;
      expect(tables!.n).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("--dry-run n'écrit rien (pas même le schéma de suivi) et liste les migrations en attente", async () => {
    const sql = await freshDb();
    try {
      const r = await runMigrations({ sql, dir: migrationsDir, dryRun: true });
      expect(r.pending).toHaveLength(12);
      const [t] = await sql`select to_regclass('coachos_migrations.applied') is not null as ok, to_regclass('auth.users') is not null as auth`;
      expect(t).toEqual({ ok: false, auth: false });
    } finally {
      await sql.end();
    }
  });

  it("ATOMICITÉ : un fichier qui échoue en son milieu n'en laisse RIEN ; le fichier précédent reste ; la correction reprend au bon fichier", async () => {
    const sql = await freshDb();
    const dir = tempMigrations({
      "20260101000001_ok.sql": "create table public.t_ok (id int);",
      "20260101000002_bad.sql": "create table public.t_demi (id int); select 1/0; create table public.t_apres (id int);",
    });
    try {
      const m = await msg(runMigrations({ sql, dir }));
      expect(m).toMatch(/20260101000002_bad\.sql/);
      expect(m).toMatch(/annulée/);
      const [objs] = await sql`select to_regclass('public.t_ok') is not null as ok, to_regclass('public.t_demi') is not null as demi, to_regclass('public.t_apres') is not null as apres`;
      expect(objs).toEqual({ ok: true, demi: false, apres: false }); // rien du fichier fautif
      expect((await readApplied(sql)).map((r: { name: string }) => r.name)).toEqual(["20260101000001_ok.sql"]);

      writeFileSync(path.join(dir, "20260101000002_bad.sql"), "create table public.t_demi (id int);"); // correction du fichier JAMAIS appliqué : autorisée
      const r = await runMigrations({ sql, dir });
      expect(r.applied).toHaveLength(2);
      const [after] = await sql`select to_regclass('public.t_demi') is not null as demi`;
      expect(after!.demi).toBe(true);
    } finally {
      await sql.end();
    }
  });

  it("REFUSE une migration modifiée après application, une migration appliquée disparue, et une migration en attente plus ancienne", async () => {
    const sql = await freshDb();
    const dir = tempMigrations({ "20260101000010_a.sql": "create table public.t_a (id int);", "20260101000020_b.sql": "create table public.t_b (id int);" });
    try {
      await runMigrations({ sql, dir });
      writeFileSync(path.join(dir, "20260101000010_a.sql"), "create table public.t_a (id int, extra int);");
      expect(await msg(runMigrations({ sql, dir }))).toMatch(/modifiée après son application/);
      writeFileSync(path.join(dir, "20260101000010_a.sql"), "create table public.t_a (id int);");

      writeFileSync(path.join(dir, "20260101000005_ancienne.sql"), "create table public.t_old (id int);");
      expect(await msg(runMigrations({ sql, dir }))).toMatch(/plus ancienne/);
      rmSync(path.join(dir, "20260101000005_ancienne.sql"));

      rmSync(path.join(dir, "20260101000020_b.sql"));
      expect(await msg(runMigrations({ sql, dir }))).toMatch(/n'existe plus/);
    } finally {
      await sql.end();
    }
  });

  it("REFUSE une exécution simultanée (verrou consultatif) et un nom de fichier invalide", async () => {
    const sql = await freshDb();
    const dir = tempMigrations({ "20260101000001_ok.sql": "select 1;" });
    const holder = postgres(urlOf.get(sql)!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await holder`select pg_advisory_lock(hashtext('coachos_migrations')::bigint)`;
      expect(await msg(runMigrations({ sql, dir }))).toMatch(/autre exécution/);
      await holder`select pg_advisory_unlock(hashtext('coachos_migrations')::bigint)`;
      await runMigrations({ sql, dir }); // le verrou est libéré : ça passe
      writeFileSync(path.join(dir, "mauvais-nom.sql"), "select 1;");
      expect(() => loadMigrations(dir)).toThrow(/nom de migration invalide/);
    } finally {
      await holder.end();
      await sql.end();
    }
  });
});

describe("lanceur de migrations : collisions de rôles globaux (cluster partagé)", () => {
  it("detectRoleCollisions : un rôle homonyme SANS marqueur est une collision ; avec le marqueur Coach OS, non", async () => {
    const probe = `coachos_collision_probe_${Math.random().toString(36).slice(2, 8)}`;
    await adminSql().unsafe(`create role ${probe} nologin`);
    try {
      expect(await detectRoleCollisions(adminSql(), [probe, "role_qui_n_existe_pas"])).toEqual([probe]);
      await adminSql().unsafe(`comment on role ${probe} is '${ROLE_MARKER}'`);
      expect(await detectRoleCollisions(adminSql(), [probe])).toEqual([]);
    } finally {
      await adminSql().unsafe(`drop role ${probe}`);
    }
    expect(COACHOS_ROLES).toEqual(["anon", "authenticated", "app_server", "auth_runtime"]);
  });

  it("une base VIERGE est REFUSÉE si l'un des quatre rôles existe sans marqueur ; acceptée (second environnement Coach OS) quand ils sont marqués", async () => {
    const sql = await freshDb();
    try {
      // Les rôles du cluster de test portent le marqueur (migration 0008) : un second environnement dans le même cluster est accepté.
      expect(await detectRoleCollisions(sql)).toEqual([]);
      await adminSql().unsafe("comment on role anon is null"); // simule un rôle appartenant à une AUTRE application
      try {
        const m = await msg(runMigrations({ sql, dir: migrationsDir }));
        expect(m).toMatch(/anon/);
        expect(m).toMatch(/cluster dédié|renommer/);
        const [t] = await sql`select to_regclass('auth.users') is not null as auth, to_regclass('coachos_migrations.applied') is not null as tracking`;
        expect(t).toEqual({ auth: false, tracking: false }); // aucune écriture avant le refus
      } finally {
        await adminSql().unsafe(`comment on role anon is '${ROLE_MARKER}'`);
      }
      const ok = await runMigrations({ sql, dir: migrationsDir });
      expect(ok.applied).toHaveLength(12);
    } finally {
      await sql.end();
    }
  });
});

describe("planMigrations (pure)", () => {
  const f = (v: string, c = "x") => ({ version: v, name: `${v}_n.sql`, checksum: c, sql: "" });
  it("planifie, détecte l'empreinte modifiée, l'ordre et les fichiers disparus", () => {
    expect(planMigrations([], [f("1"), f("2")]).map((m: { version: string }) => m.version)).toEqual(["1", "2"]);
    expect(planMigrations([{ version: "1", name: "1_n.sql", checksum: "x" }], [f("1"), f("2")]).map((m: { version: string }) => m.version)).toEqual(["2"]);
    expect(() => planMigrations([{ version: "1", name: "1_n.sql", checksum: "autre" }], [f("1")])).toThrow(/modifiée/);
    expect(() => planMigrations([{ version: "2", name: "2_n.sql", checksum: "x" }], [f("1"), f("2")])).toThrow(/plus ancienne/);
    expect(() => planMigrations([{ version: "9", name: "9_n.sql", checksum: "x" }], [f("1")])).toThrow(/n'existe plus/);
  });
});
