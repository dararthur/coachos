import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclaration de types
import { checkAuthDatabase, checkDatabase, checkEnv, expectedObjects } from "../../scripts/lib/preflight.mjs";
import { closeAll } from "./support";

type Check = { id: string; label: string; status: "ok" | "fail" | "warn"; detail?: string };
const migrationsDir = path.resolve(import.meta.dirname, "../../db/migrations");
afterAll(closeAll);

const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id);
const rand = () => randomBytes(24).toString("hex");

describe("préflight : contrôles base de données (réels)", () => {
  it("la connexion app_server de l'application passe tous les contrôles de sécurité", async () => {
    const sql = postgres(process.env.TEST_APP_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const checks: Check[] = await checkDatabase(sql, { migrationsDir, remote: false });
      const failures = checks.filter((c) => c.status === "fail");
      expect(failures, JSON.stringify(failures)).toEqual([]);
      for (const id of ["db.role", "db.no_table_privileges", "db.rls_enabled", "db.anon_closed", "db.set_role", "db.rls_blocks", "db.migrations"]) {
        expect(byId(checks, id)?.status, id).toBe("ok");
      }
      expect(byId(checks, "db.ssl")?.status).toBe("warn"); // local sans SSL : signalé, pas masqué
    } finally {
      await sql.end();
    }
  });

  it("détecte une mauvaise connexion : superutilisateur au lieu d'app_server", async () => {
    const sql = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const checks: Check[] = await checkDatabase(sql, { migrationsDir, remote: false });
      expect(byId(checks, "db.role")?.status).toBe("fail");
      expect(byId(checks, "db.no_table_privileges")?.status).toBe("fail");
    } finally {
      await sql.end();
    }
  });

  it("détecte une table sans RLS et une migration manquante", async () => {
    const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
    const app = postgres(process.env.TEST_APP_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await admin`create table public.oubli_rls (id int)`;
      let checks: Check[] = await checkDatabase(app, { migrationsDir, remote: false });
      expect(byId(checks, "db.rls_enabled")?.status).toBe("fail");
      expect(byId(checks, "db.rls_enabled")?.detail).toContain("oubli_rls");
      await admin`drop table public.oubli_rls`;

      await admin`alter table public.checkin_tokens rename to checkin_tokens_old`;
      checks = await checkDatabase(app, { migrationsDir, remote: false });
      expect(byId(checks, "db.migrations")?.status).toBe("fail");
      expect(byId(checks, "db.migrations")?.detail).toContain("checkin_tokens");
      await admin`alter table public.checkin_tokens_old rename to checkin_tokens`;
      expect(byId(await checkDatabase(app, { migrationsDir, remote: false }), "db.migrations")?.status).toBe("ok");
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it("la liste attendue vient des migrations réelles", () => {
    const exp = expectedObjects(migrationsDir);
    expect(exp.files).toHaveLength(8);
    expect(exp.tables).toEqual(expect.arrayContaining(["academies", "people", "attendance", "session_checkins", "checkin_tokens"]));
    expect(exp.functions).toEqual(expect.arrayContaining(["create_academy", "checkin_redeem", "erase_person"]));
  });
});

describe("préflight : connexion auth_runtime (réelle)", () => {
  it("la connexion de Better Auth passe tous les contrôles ; app_server et superuser sont refusés", async () => {
    const auth = postgres(process.env.TEST_AUTH_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const checks: Check[] = await checkAuthDatabase(auth);
      expect(checks.filter((c) => c.status === "fail"), JSON.stringify(checks.filter((c) => c.status === "fail"))).toEqual([]);
      for (const id of ["auth.role", "auth.no_business_access", "auth.no_ddl", "auth.tables", "auth.closed"]) expect(byId(checks, id)?.status, id).toBe("ok");
    } finally {
      await auth.end();
    }
    const wrong = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const checks: Check[] = await checkAuthDatabase(wrong);
      expect(byId(checks, "auth.role")?.status).toBe("fail");
      expect(byId(checks, "auth.no_ddl")?.status).toBe("fail");
    } finally {
      await wrong.end();
    }
    const app = postgres(process.env.TEST_APP_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const checks: Check[] = await checkAuthDatabase(app);
      expect(byId(checks, "auth.role")?.status).toBe("fail");
      expect(byId(checks, "auth.tables")?.status).toBe("fail"); // app_server ne peut pas lire auth.users
    } finally {
      await app.end();
    }
  });
});

describe("préflight : configuration", () => {
  const good = () => ({
    DATABASE_URL: `postgresql://app_server:${rand()}@127.0.0.1:5432/coachos`,
    AUTH_DATABASE_URL: `postgresql://auth_runtime:${rand()}@127.0.0.1:5432/coachos`,
    SITE_URL: "https://pilote.exemple.fr", APP_SECRET: rand(), BETTER_AUTH_SECRET: rand(), CRON_SECRET: rand(), APP_ENV: "staging",
    MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_" + rand(), MAIL_FROM: "Coach OS <no-reply@exemple.fr>",
  });

  it("accepte une configuration de préproduction correcte", () => {
    const checks: Check[] = checkEnv(good());
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(byId(checks, "env.mail.provider")?.status).toBe("ok");
  });

  it("refuse : variable absente, secrets courts ou identiques, http, localhost, mauvais rôles, e-mail de test, production", () => {
    const bad = (patch: Record<string, string | undefined>) => checkEnv({ ...good(), ...patch }) as Check[];
    expect(byId(bad({ APP_SECRET: undefined }), "env.APP_SECRET")?.status).toBe("fail");
    expect(byId(bad({ BETTER_AUTH_SECRET: undefined }), "env.BETTER_AUTH_SECRET")?.status).toBe("fail");
    expect(byId(bad({ APP_SECRET: "court" }), "env.APP_SECRET.length")?.status).toBe("fail");
    expect(byId(bad({ BETTER_AUTH_SECRET: "court" }), "env.BETTER_AUTH_SECRET.length")?.status).toBe("fail");
    const same = rand();
    expect(byId(bad({ APP_SECRET: same, BETTER_AUTH_SECRET: same }), "env.secrets.distinct")?.status).toBe("fail");
    expect(byId(bad({ SITE_URL: "http://pilote.exemple.fr" }), "env.SITE_URL.https")?.status).toBe("fail");
    expect(byId(bad({ SITE_URL: "http://localhost:3000" }), "env.SITE_URL.public")?.status).toBe("fail");
    expect(byId(bad({ DATABASE_URL: `postgresql://postgres:${rand()}@127.0.0.1:5432/coachos` }), "env.db.user")?.status).toBe("fail");
    expect(byId(bad({ AUTH_DATABASE_URL: `postgresql://app_server:${rand()}@127.0.0.1:5432/coachos` }), "env.authdb.user")?.status).toBe("fail");
    expect(byId(bad({ SUPABASE_SERVICE_ROLE_KEY: rand() }), "env.no_service_role")?.status).toBe("fail");
    expect(byId(bad({ SUPABASE_URL: "https://x.supabase.co" }), "env.legacy_supabase")?.status).toBe("warn");
    expect(byId(bad({ MAIL_PROVIDER: "outbox" }), "env.mail.provider")?.status).toBe("fail");
    expect(byId(bad({ RESEND_API_KEY: undefined }), "env.mail.key")?.status).toBe("fail");
    expect(byId(bad({ MAIL_FROM: undefined }), "env.mail.from")?.status).toBe("fail");
    expect(byId(bad({ MAIL_PROVIDER: "autre" }), "env.mail.provider")?.status).toBe("fail");
    expect(byId(bad({ APP_ENV: "production" }), "env.APP_ENV")?.status).toBe("fail");
    expect(byId(checkEnv({ ...good(), APP_ENV: "production" }, { allowProduction: true }), "env.APP_ENV")?.status).toBe("ok");
    expect(byId(bad({ CRON_SECRET: undefined }), "env.CRON_SECRET")?.status).toBe("warn");
  });

  it("n'inclut jamais de valeur secrète dans ses messages", () => {
    const env = { ...good(), APP_SECRET: "S3cr3t-" + rand(), BETTER_AUTH_SECRET: "S3cr3t-" + rand() };
    const dump = JSON.stringify(checkEnv(env));
    for (const value of [env.APP_SECRET, env.BETTER_AUTH_SECRET, env.CRON_SECRET, env.RESEND_API_KEY, new URL(env.DATABASE_URL).password, new URL(env.AUTH_DATABASE_URL).password]) expect(dump).not.toContain(value);
  });
});
