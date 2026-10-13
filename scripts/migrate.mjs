// Applique les migrations de db/migrations/ (transactionnel, suivi, vérifié). Voir scripts/lib/migrate.mjs et docs/operations.md.
//
//   MIGRATION_DATABASE_URL=… node scripts/migrate.mjs            applique les migrations en attente
//   MIGRATION_DATABASE_URL=… node scripts/migrate.mjs --dry-run  liste ce qui serait appliqué, sans rien écrire
//
// L'URL est celle d'un rôle ADMINISTRATEUR (création de rôles), jamais app_server ni auth_runtime. Elle n'est jamais affichée.
import path from "node:path";
import postgres from "postgres";
import { sslViolation } from "./lib/db-url.mjs";
import { MigrationError, runMigrations } from "./lib/migrate.mjs";

const dir = path.resolve(import.meta.dirname, "../db/migrations");
const dryRun = process.argv.includes("--dry-run");
const url = process.env.MIGRATION_DATABASE_URL;

if (!url) {
  console.error("MIGRATION_DATABASE_URL est requis (URL d'un rôle administrateur de la base cible). Rien n'a été fait.");
  process.exit(2);
}
const ssl = sslViolation(url);
if (ssl) {
  console.error(`MIGRATION_DATABASE_URL refusée : ${ssl}. Rien n'a été fait.`);
  process.exit(2);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
try {
  const result = await runMigrations({ sql, dir, dryRun, log: (l) => console.log(l) });
  console.log(`${result.version.message}.`);
  if (dryRun) {
    console.log(`déjà appliquées : ${result.applied.length} ; en attente : ${result.pending.length}`);
    for (const name of result.pending) console.log(`  à appliquer : ${name}`);
  } else {
    console.log(`terminé : ${result.applied.length} migration(s) appliquée(s) au total.`);
  }
} catch (error) {
  console.error(error instanceof MigrationError ? `REFUSÉ : ${error.message}` : `ERREUR : ${error?.code ?? ""} ${String(error?.message ?? error).slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
