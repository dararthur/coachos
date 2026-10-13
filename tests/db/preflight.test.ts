import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclaration de types
import { checkAuth, checkDatabase, checkEnv, expectedObjects, summarize } from "../../scripts/lib/preflight.mjs";
import { closeAll } from "./support";

type Check = { id: string; label: string; status: "ok" | "fail" | "warn"; detail?: string };
const migrationsDir = path.resolve(import.meta.dirname, "../../supabase/migrations");
afterAll(closeAll);

const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id);
const rand = () => randomBytes(24).toString("hex");
const fakeJwt = (role: string) => ["e30", Buffer.from(JSON.stringify({ role })).toString("base64url"), "sig"].join(".");

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
    expect(exp.files).toHaveLength(6);
    expect(exp.tables).toEqual(expect.arrayContaining(["academies", "people", "attendance", "session_checkins", "checkin_tokens"]));
    expect(exp.functions).toEqual(expect.arrayContaining(["create_academy", "checkin_redeem", "erase_person"]));
  });
});

describe("préflight : configuration", () => {
  const good = () => ({
    SUPABASE_URL: "https://abcdefgh.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + rand(),
    DATABASE_URL: `postgresql://app_server.abcdefgh:${rand()}@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`,
    SITE_URL: "https://pilote.exemple.fr", APP_SECRET: rand(), CRON_SECRET: rand(), APP_ENV: "staging",
  });

  it("accepte une configuration de préproduction correcte", () => {
    const checks: Check[] = checkEnv(good());
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(byId(checks, "env.project_ref")?.status).toBe("ok");
  });

  it("refuse : variable absente, secret court, http, localhost, rôle postgres, clé service_role, projets mélangés, production", () => {
    const bad = (patch: Record<string, string | undefined>) => checkEnv({ ...good(), ...patch }) as Check[];
    expect(byId(bad({ APP_SECRET: undefined }), "env.APP_SECRET")?.status).toBe("fail");
    expect(byId(bad({ APP_SECRET: "court" }), "env.APP_SECRET.length")?.status).toBe("fail");
    expect(byId(bad({ SITE_URL: "http://pilote.exemple.fr" }), "env.SITE_URL.https")?.status).toBe("fail");
    expect(byId(bad({ SITE_URL: "http://localhost:3000" }), "env.SITE_URL.public")?.status).toBe("fail");
    expect(byId(bad({ DATABASE_URL: `postgresql://postgres.abcdefgh:${rand()}@x.pooler.supabase.com:6543/postgres` }), "env.db.user")?.status).toBe("fail");
    expect(byId(bad({ SUPABASE_PUBLISHABLE_KEY: fakeJwt("service_role") }), "env.key.public")?.status).toBe("fail");
    expect(byId(bad({ SUPABASE_PUBLISHABLE_KEY: "sb_secret_" + rand() }), "env.key.public")?.status).toBe("fail");
    expect(byId(bad({ SUPABASE_SERVICE_ROLE_KEY: rand() }), "env.no_service_role")?.status).toBe("fail");
    expect(byId(bad({ DATABASE_URL: `postgresql://app_server.zzzzzzzz:${rand()}@db.zzzzzzzz.supabase.co:5432/postgres` }), "env.project_ref")?.status).toBe("fail");
    expect(byId(bad({ APP_ENV: "production" }), "env.APP_ENV")?.status).toBe("fail");
    expect(byId(checkEnv({ ...good(), APP_ENV: "production" }, { allowProduction: true }), "env.APP_ENV")?.status).toBe("ok");
    expect(byId(bad({ CRON_SECRET: undefined }), "env.CRON_SECRET")?.status).toBe("warn");
  });

  it("n'inclut jamais de valeur secrète dans ses messages", () => {
    const env = { ...good(), APP_SECRET: "S3cr3t-" + rand(), SUPABASE_PUBLISHABLE_KEY: "sb_secret_" + rand() };
    const dump = JSON.stringify(checkEnv(env));
    for (const value of [env.APP_SECRET, env.SUPABASE_PUBLISHABLE_KEY, env.CRON_SECRET, new URL(env.DATABASE_URL).password]) expect(dump).not.toContain(value);
  });
});

describe("préflight : Supabase Auth", () => {
  async function withServer(settings: unknown, status = 200, fn: (url: string) => Promise<void>) {
    const server = http.createServer((req, res) => {
      res.writeHead(req.url?.startsWith("/auth/v1/settings") && req.headers.apikey ? status : 401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it("valide des réglages sûrs, refuse l'auto-confirmation des e-mails, signale l'inaccessibilité", async () => {
    await withServer({ external: { email: true }, disable_signup: false, mailer_autoconfirm: false }, 200, async (url) => {
      const checks: Check[] = await checkAuth(url, "cle-publique-factice");
      expect(summarize(checks).fail).toBe(0);
    });
    await withServer({ external: { email: true }, disable_signup: false, mailer_autoconfirm: true }, 200, async (url) => {
      const checks: Check[] = await checkAuth(url, "cle-publique-factice");
      expect(byId(checks, "auth.confirm")?.status).toBe("fail");
    });
    await withServer({}, 401, async (url) => {
      expect(byId(await checkAuth(url, "cle"), "auth.reachable")?.status).toBe("fail");
    });
    expect(byId(await checkAuth("http://127.0.0.1:1", "cle"), "auth.reachable")?.status).toBe("fail");
  });
});
