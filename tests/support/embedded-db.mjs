// PostgreSQL réel (binaires embarqués) pour les tests d'intégration et la pile e2e locale.
// PostgreSQL standard : le socle (rôles, schéma auth de Better Auth, auth.uid()) vient de la migration 0000.
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function migrationFiles() {
  const dir = path.join(root, "db", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(path.join(dir, f), "utf8") }));
}

/** @param {{ port?: number }} [opts] */
export async function startEmbeddedDb(opts = {}) {
  const port = opts.port ?? 54000 + Math.floor(Math.random() * 900);
  const superPassword = randomBytes(18).toString("hex");
  const appPassword = randomBytes(18).toString("hex");
  const authPassword = randomBytes(18).toString("hex");
  const databaseDir = mkdtempSync(path.join(tmpdir(), "coachos-pg-"));

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: superPassword,
    port,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("coachos");

  const adminUrl = `postgres://postgres:${superPassword}@127.0.0.1:${port}/coachos`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    for (const m of migrationFiles()) {
      try {
        await admin.unsafe(m.sql);
      } catch (e) {
        throw new Error(`Migration ${m.name} en échec : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await admin.unsafe(`alter role app_server login password '${appPassword}'`);
    await admin.unsafe(`alter role auth_runtime login password '${authPassword}'`);
  } finally {
    await admin.end();
  }

  return {
    port,
    adminUrl,
    appUrl: `postgres://app_server:${appPassword}@127.0.0.1:${port}/coachos`,
    authUrl: `postgres://auth_runtime:${authPassword}@127.0.0.1:${port}/coachos`,
    async stop() {
      await pg.stop();
      try {
        rmSync(databaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        /* nettoyage au mieux */
      }
    },
  };
}
