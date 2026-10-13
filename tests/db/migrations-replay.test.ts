import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { migrationFiles } from "../support/embedded-db.mjs";
import { adminSql, closeAll } from "./support";

afterAll(closeAll);

describe("migrations : reproductibilité sur PostgreSQL standard", () => {
  it("rejouées depuis zéro sur une seconde base du même cluster (rôles déjà existants) : mêmes invariants de sécurité", async () => {
    const files = migrationFiles();
    expect(files.map((f) => f.name)[0]).toMatch(/^20261013000000_platform_bootstrap/);
    expect(files.at(-1)?.name).toMatch(/better_auth_adaptation/);

    await adminSql().unsafe("create database coachos_replay");
    const url = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
    url.pathname = "/coachos_replay";
    const replay = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      for (const f of files) await replay.unsafe(f.sql); // idempotent pour les rôles (cluster partagé)
      const [rls] = await replay<{ n: number }[]>`select count(*)::int as n from pg_tables where schemaname = 'public' and not rowsecurity`;
      expect(rls!.n).toBe(0);
      const [auth] = await replay<{ n: number }[]>`select count(*)::int as n from pg_tables where schemaname = 'auth'`;
      expect(auth!.n).toBe(4);
      const [privileged] = await replay<{ n: number }[]>`
        select count(*)::int as n from pg_roles
        where rolname in ('app_server', 'auth_runtime', 'anon', 'authenticated') and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)`;
      expect(privileged!.n).toBe(0);
      const grants = await replay<{ grantee: string }[]>`
        select distinct grantee from information_schema.role_table_grants
        where table_schema = 'auth' and grantee not in ('auth_runtime', 'postgres')`;
      expect(grants).toEqual([]);
    } finally {
      await replay.end();
      await adminSql().unsafe("drop database coachos_replay");
    }
  });
});
