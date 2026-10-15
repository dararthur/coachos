import { spawnSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { adminSql, closeAll } from "./support";

const script = path.resolve(import.meta.dirname, "../../scripts/migrate.mjs");
const created: string[] = [];
afterAll(async () => {
  for (const db of created) await adminSql().unsafe(`drop database if exists ${db} with (force)`);
  await closeAll();
});

const run = (env: Record<string, string | undefined>, args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, MIGRATION_DATABASE_URL: "", ...env } });

describe("scripts/migrate.mjs (processus réel)", () => {
  it("refuse sans URL (code 2), avec une URL distante sans SSL (code 2), sans rien écrire ni afficher l'URL", () => {
    const none = run({});
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/MIGRATION_DATABASE_URL est requis/);
    const secret = "Sup3rS3cretDePassage";
    const remote = run({ MIGRATION_DATABASE_URL: `postgresql://admin:${secret}@db.exemple.fr:5432/coachos` });
    expect(remote.status).toBe(2);
    expect(remote.stderr).toMatch(/sslmode/);
    expect(remote.stdout + remote.stderr).not.toContain(secret);
  });

  it("applique sur une base vierge, relance sans effet, --dry-run n'écrit rien ; un rôle applicatif est refusé", async () => {
    const name = `coachos_cli_${Math.random().toString(36).slice(2, 9)}`;
    await adminSql().unsafe(`create database ${name}`);
    created.push(name);
    const admin = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
    admin.pathname = `/${name}`;
    const url = admin.toString();

    const dry = run({ MIGRATION_DATABASE_URL: url }, ["--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/en attente : 24/);
    const probe = postgres(url, { max: 1, onnotice: () => {} });
    expect((await probe`select to_regclass('coachos_migrations.applied') is not null as ok`)[0]!.ok).toBe(false);

    const first = run({ MIGRATION_DATABASE_URL: url });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/24 migration\(s\) appliquée\(s\) au total/);
    expect((await probe`select count(*)::int as n from coachos_migrations.applied`)[0]!.n).toBe(24);
    const again = run({ MIGRATION_DATABASE_URL: url }, ["--dry-run"]);
    expect(again.stdout).toMatch(/en attente : 0/);
    await probe.end();
    expect(first.stdout + first.stderr).not.toContain(new URL(url).password);

    const app = new URL(process.env.TEST_APP_DATABASE_URL!);
    app.pathname = `/${name}`;
    const refused = run({ MIGRATION_DATABASE_URL: app.toString() });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/créer des rôles/);
  });
});
