// Pile locale pour les tests e2e SANS Docker : PostgreSQL embarqué (migrations réelles, RLS réelle)
// + faux GoTrue + serveur Next.js de production (`next start`). Lancée par playwright.config.ts.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startEmbeddedDb } from "../../support/embedded-db.mjs";
import { startMockAuth } from "./mock-auth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const appPort = Number(process.env.E2E_PORT ?? 3100);
const authPort = appPort + 1;

const db = await startEmbeddedDb();
const auth = await startMockAuth({ port: authPort, adminUrl: db.adminUrl });

const env = {
  ...process.env,
  NODE_ENV: "production",
  SITE_URL: `http://127.0.0.1:${appPort}`,
  SUPABASE_URL: auth.url,
  SUPABASE_PUBLISHABLE_KEY: randomBytes(24).toString("hex"),
  DATABASE_URL: db.appUrl,
  DATABASE_SSL: "disable",
  APP_SECRET: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
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
  await auth.stop().catch(() => {});
  await db.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
next.on("exit", (code) => shutdown(code ?? 0));
console.log(`[e2e-stack] prête : app http://127.0.0.1:${appPort}, auth ${auth.url}, pg :${db.port}`);
