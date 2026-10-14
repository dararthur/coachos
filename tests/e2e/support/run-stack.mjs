// Pile locale pour les tests e2e SANS Docker : PostgreSQL embarqué (migrations réelles, RLS réelle)
// + vrai Better Auth (boîte d'envoi d'e-mails dans un fichier, aucun réseau) + serveur Next.js de production (`next start`).
// Lancée par playwright.config.ts.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startEmbeddedDb } from "../../support/embedded-db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const appPort = Number(process.env.E2E_PORT ?? 3100);
const outbox = path.join(os.tmpdir(), `coachos-e2e-outbox-${appPort}.jsonl`);
writeFileSync(outbox, "");
// Accès administrateur à la base de test (fixtures des tests e2e : demandes de club approuvées), lu par tests/e2e/support/helpers.ts.
const dbInfo = path.join(os.tmpdir(), `coachos-e2e-db-${appPort}.json`);

const db = await startEmbeddedDb();

writeFileSync(dbInfo, JSON.stringify({ adminUrl: db.adminUrl }));

const env = {
  ...process.env,
  NODE_ENV: "production",
  // Configuration de TEST explicite : seule cette valeur (avec une SITE_URL locale) autorise MAIL_PROVIDER=outbox.
  APP_ENV: "test",
  SITE_URL: `http://127.0.0.1:${appPort}`,
  DATABASE_URL: db.appUrl,
  AUTH_DATABASE_URL: db.authUrl,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  MAIL_PROVIDER: "outbox",
  MAIL_OUTBOX_FILE: outbox,
  DATABASE_SSL: "disable",
  APP_SECRET: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
  PLATFORM_ADMIN_EMAIL: "admin-e2e@example.invalid",
  CHECKIN_TOKEN_TTL_SECONDS: "10", // jetons très courts : permet de tester l'expiration en quelques secondes
  PORT: String(appPort),
};

const next = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(appPort), "-H", "127.0.0.1"], {
  cwd: root,
  env,
  stdio: "inherit",
});

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  next.kill();
  rmSync(outbox, { force: true });
  rmSync(dbInfo, { force: true });
  await db.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
next.on("exit", (code) => shutdown(code ?? 0));
console.log(`[e2e-stack] prête : app http://127.0.0.1:${appPort}, pg :${db.port}`);
