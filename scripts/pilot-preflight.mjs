// Contrôle de préproduction : `node --env-file=.env.staging scripts/pilot-preflight.mjs`
// (le fichier d'environnement n'est jamais versionné ; ce script n'affiche aucune valeur secrète).
import path from "node:path";
import postgres from "postgres";
import { checkAuthDatabase, checkDatabase, checkEnv, checkMigrationTracking, summarize } from "./lib/preflight.mjs";

const args = new Set(process.argv.slice(2));
const migrationsDir = path.resolve(import.meta.dirname, "../db/migrations");
const icon = { ok: "✔", warn: "▲", fail: "✘" };

const checks = [];
checks.push(...checkEnv(process.env, { allowProduction: args.has("--production"), allowHttp: args.has("--allow-http") }));

const ssl = process.env.DATABASE_SSL === "disable" ? false : undefined;
const connect = (url) => postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15, ssl });

async function withDb(url, label, fn) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    console.error(`${label} invalide : contrôles ignorés.`);
    return;
  }
  const sql = connect(url);
  try {
    checks.push(...(await fn(sql, !["localhost", "127.0.0.1", "::1"].includes(host))));
  } catch (e) {
    checks.push({ id: `${label}.connect`, label: `connexion ${label}`, status: "fail", detail: `erreur : ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 120)}` });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.env.DATABASE_URL) await withDb(process.env.DATABASE_URL, "DATABASE_URL", (sql, remote) => checkDatabase(sql, { migrationsDir, remote }));
if (process.env.AUTH_DATABASE_URL) await withDb(process.env.AUTH_DATABASE_URL, "AUTH_DATABASE_URL", (sql, remote) => checkAuthDatabase(sql, { remote }));
if (process.env.MIGRATION_DATABASE_URL) await withDb(process.env.MIGRATION_DATABASE_URL, "MIGRATION_DATABASE_URL", (sql) => checkMigrationTracking(sql, migrationsDir));
else checks.push({ id: "migrations.tracking", label: "suivi des migrations vérifié", status: "warn", detail: "MIGRATION_DATABASE_URL absent : fournir l'URL administrateur (lecture seule) pour contrôler les empreintes des migrations" });

for (const c of checks) console.log(`${icon[c.status]} ${c.label}${c.detail ? `\n    ${c.detail}` : ""}`);
const s = summarize(checks);
console.log(`\nRésultat : ${s.ok} OK, ${s.warn} avertissement(s), ${s.fail} échec(s).`);
console.log("Rappel : ce script ne remplace pas les vérifications manuelles de docs/pilot.md (invitation réelle, suppression, sauvegarde, e-mails réels).");
process.exit(s.fail > 0 ? 1 : 0);
