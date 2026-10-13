// Contrôle de préproduction : `node --env-file=.env.staging scripts/pilot-preflight.mjs`
// (le fichier d'environnement n'est jamais versionné ; ce script n'affiche aucune valeur secrète).
import path from "node:path";
import postgres from "postgres";
import { checkAuth, checkDatabase, checkEnv, summarize } from "./lib/preflight.mjs";

const args = new Set(process.argv.slice(2));
const migrationsDir = path.resolve(import.meta.dirname, "../supabase/migrations");
const icon = { ok: "✔", warn: "▲", fail: "✘" };

const checks = [];
checks.push(...checkEnv(process.env, { allowProduction: args.has("--production"), allowHttp: args.has("--allow-http") }));

if (checks.some((c) => c.status === "fail" && c.id.startsWith("env.") && (c.id.includes("DATABASE_URL") || c.id.startsWith("env.db.valid")))) {
  console.error("DATABASE_URL manquant ou invalide : contrôles base ignorés.");
} else if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  const remote = !["localhost", "127.0.0.1"].includes(url.hostname);
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15, ssl: process.env.DATABASE_SSL === "disable" ? false : undefined });
  try {
    checks.push(...(await checkDatabase(sql, { migrationsDir, remote })));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) checks.push(...(await checkAuth(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY)));

for (const c of checks) console.log(`${icon[c.status]} ${c.label}${c.detail ? `\n    ${c.detail}` : ""}`);
const s = summarize(checks);
console.log(`\nRésultat : ${s.ok} OK, ${s.warn} avertissement(s), ${s.fail} échec(s).`);
console.log("Rappel : ce script ne remplace pas les vérifications manuelles de docs/pilot.md (invitation réelle, suppression, sauvegarde).");
process.exit(s.fail > 0 ? 1 : 0);
