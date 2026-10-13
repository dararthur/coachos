// Lanceur de migrations de Coach OS : transactionnel, suivi, vérifié. Aucune dépendance autre que `postgres`.
//
// Garanties :
//   - CHAQUE fichier s'applique dans UNE transaction avec l'écriture de son suivi : un échec ne laisse rien à moitié appliqué,
//     la correction puis la relance reprennent exactement au fichier fautif ;
//   - un fichier déjà appliqué dont le contenu a changé (empreinte SHA-256) est REFUSÉ : on ajoute une migration, on ne modifie pas ;
//   - l'ordre est strict : une migration en attente plus ancienne qu'une migration appliquée est refusée ;
//   - sur une base vierge, un rôle global homonyme préexistant (anon, authenticated, app_server, auth_runtime) SANS marqueur est refusé
//     (sinon il serait adopté en silence sur un cluster partagé) ;
//   - un verrou consultatif interdit deux exécutions simultanées ;
//   - la version de PostgreSQL est évaluée (scripts/lib/pg-version.mjs).
// Le suivi vit dans le schéma `coachos_migrations`, fermé à tous les rôles applicatifs.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { assessPostgresVersion } from "./pg-version.mjs";

export const TRACKING_SCHEMA = "coachos_migrations";
export const ROLE_MARKER = "coachos:managed";
export const COACHOS_ROLES = ["anon", "authenticated", "app_server", "auth_runtime"];
const FILE_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = "coachos_migrations";

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
}

export const checksum = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** Lit les fichiers `AAAAMMJJHHMMSS_nom.sql` du dossier, triés, avec leur empreinte (fins de ligne normalisées). */
export function loadMigrations(dir) {
  const names = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Set();
  return names.map((name) => {
    const m = FILE_PATTERN.exec(name);
    if (!m) throw new MigrationError(`nom de migration invalide : ${name} (attendu AAAAMMJJHHMMSS_nom.sql)`);
    if (seen.has(m[1])) throw new MigrationError(`version de migration en double : ${m[1]}`);
    seen.add(m[1]);
    const sql = readFileSync(path.join(dir, name), "utf8");
    return { version: m[1], name, sql, checksum: checksum(sql) };
  });
}

/**
 * Calcule ce qu'il reste à appliquer et refuse toute incohérence. Pure : testable sans base.
 * @param {{ version: string, name: string, checksum: string }[]} applied
 * @param {{ version: string, name: string, checksum: string, sql: string }[]} files
 */
export function planMigrations(applied, files) {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const a of applied) {
    const f = byVersion.get(a.version);
    if (!f) throw new MigrationError(`la migration appliquée ${a.name} n'existe plus dans le dépôt`);
    if (f.checksum !== a.checksum) throw new MigrationError(`la migration ${a.name} a été modifiée après son application (empreinte différente) : ajouter une nouvelle migration au lieu de la modifier`);
  }
  const appliedVersions = new Set(applied.map((a) => a.version));
  const maxApplied = applied.map((a) => a.version).sort().at(-1) ?? "";
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  const outOfOrder = pending.filter((f) => f.version < maxApplied);
  if (outOfOrder.length) throw new MigrationError(`migration(s) en attente plus ancienne(s) qu'une migration déjà appliquée : ${outOfOrder.map((f) => f.name).join(", ")}`);
  return pending;
}

/** Rôles globaux homonymes qui existent SANS le marqueur Coach OS. */
export async function detectRoleCollisions(sql, names = COACHOS_ROLES) {
  const rows = await sql`
    select r.rolname, coalesce(shobj_description(r.oid, 'pg_authid'), '') as comment
    from pg_roles r where r.rolname = any(${names})`;
  return rows.filter((r) => r.comment !== ROLE_MARKER).map((r) => r.rolname);
}

async function ensureTracking(sql) {
  await sql.unsafe(`
    create schema if not exists ${TRACKING_SCHEMA};
    revoke all on schema ${TRACKING_SCHEMA} from public;
    create table if not exists ${TRACKING_SCHEMA}.applied (
      version text primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now(),
      applied_by text not null default current_user,
      duration_ms integer not null default 0
    );
    revoke all on ${TRACKING_SCHEMA}.applied from public;`);
}

export async function readApplied(sql) {
  const [exists] = await sql`select to_regclass(${`${TRACKING_SCHEMA}.applied`}) is not null as ok`;
  if (!exists?.ok) return [];
  return sql.unsafe(`select version, name, checksum, applied_at from ${TRACKING_SCHEMA}.applied order by version`);
}

/**
 * @param {{ sql: import("postgres").Sql, dir: string, dryRun?: boolean, log?: (line: string) => void }} opts
 * @returns {Promise<{ applied: string[], pending: string[], version: ReturnType<typeof assessPostgresVersion> }>}
 */
export async function runMigrations({ sql, dir, dryRun = false, log = () => {} }) {
  const [v] = await sql`select current_setting('server_version_num')::int as num`;
  const version = assessPostgresVersion(v.num);
  if (version.level === "unsupported") throw new MigrationError(version.message);
  if (version.level === "untested") log(`AVERTISSEMENT : ${version.message}`);

  const [me] = await sql`select rolsuper, rolcreaterole from pg_roles where rolname = current_user`;
  if (!me?.rolsuper && !me?.rolcreaterole) throw new MigrationError("le rôle de migration doit pouvoir créer des rôles (superutilisateur ou CREATEROLE) : ce n'est ni app_server ni auth_runtime");

  const [lock] = await sql`select pg_try_advisory_lock(hashtext(${LOCK_KEY})::bigint) as got`;
  if (!lock?.got) throw new MigrationError("une autre exécution du lanceur de migrations est en cours");
  try {
    const files = loadMigrations(dir);
    const applied = await readApplied(sql);
    const pending = planMigrations(applied, files);

    if (applied.length === 0 && pending.length > 0) {
      const collisions = await detectRoleCollisions(sql);
      if (collisions.length) {
        throw new MigrationError(
          `rôle(s) global(aux) déjà présent(s) dans ce cluster sans appartenir à Coach OS : ${collisions.join(", ")}. ` +
            "Les adopter donnerait à Coach OS les droits d'un rôle d'une autre application. Utiliser un cluster dédié, ou renommer/supprimer ces rôles après revue.",
        );
      }
    }
    if (dryRun) return { applied: applied.map((a) => a.name), pending: pending.map((p) => p.name), version };

    await ensureTracking(sql);
    for (const m of pending) {
      const started = Date.now();
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(m.sql);
          await tx`insert into ${tx(TRACKING_SCHEMA)}.applied (version, name, checksum, duration_ms) values (${m.version}, ${m.name}, ${m.checksum}, ${Date.now() - started})`;
        });
      } catch (error) {
        // Le message PostgreSQL peut citer des objets ; il ne contient ni secret ni donnée (DDL). Tout le fichier est annulé.
        throw new MigrationError(`échec de ${m.name} : ${error?.message ?? error} — transaction annulée, rien n'a été appliqué pour ce fichier`);
      }
      log(`appliquée : ${m.name}`);
    }
    return { applied: applied.map((a) => a.name).concat(pending.map((p) => p.name)), pending: [], version };
  } finally {
    await sql`select pg_advisory_unlock(hashtext(${LOCK_KEY})::bigint)`;
  }
}
