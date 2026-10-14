// Contrôles de préproduction : configuration, connexions `app_server` et `auth_runtime`, RLS, rôles, authentification.
// Ne lit jamais de donnée métier ; n'affiche jamais de valeur secrète (noms de variables et verdicts seulement).
// Réutilisé par scripts/pilot-preflight.mjs et testé contre un vrai PostgreSQL dans tests/db/preflight.test.ts.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isLocalDatabaseUrl, sslViolation } from "./db-url.mjs";
import { loadMigrations, planMigrations, readApplied } from "./migrate.mjs";
import { assessPostgresVersion } from "./pg-version.mjs";

/** @typedef {{ id: string, label: string, status: "ok" | "fail" | "warn", detail?: string }} Check */
const ok = (id, label, detail) => ({ id, label, status: "ok", detail });
const fail = (id, label, detail) => ({ id, label, status: "fail", detail });
const warn = (id, label, detail) => ({ id, label, status: "warn", detail });

export const REQUIRED_ENV = ["DATABASE_URL", "AUTH_DATABASE_URL", "SITE_URL", "APP_SECRET", "BETTER_AUTH_SECRET", "MAIL_PROVIDER"];
export const OPTIONAL_ENV = ["CRON_SECRET", "DATABASE_SSL", "DATABASE_POOL_SIZE", "CHECKIN_TOKEN_TTL_SECONDS", "APP_ENV", "RESEND_API_KEY", "MAIL_FROM", "MAIL_OUTBOX_FILE", "PLATFORM_ADMIN_EMAIL"];

const isLocalHost = (h) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(h);

function dbUser(urlString) {
  try {
    const url = new URL(urlString);
    return { url, user: decodeURIComponent(url.username) };
  } catch {
    return null;
  }
}

/** @param {Record<string, string | undefined>} env @param {{ allowProduction?: boolean, allowHttp?: boolean }} [opts] @returns {Check[]} */
export function checkEnv(env, opts = {}) {
  /** @type {Check[]} */
  const out = [];
  for (const name of REQUIRED_ENV) {
    if (!env[name]) out.push(fail(`env.${name}`, `${name} est défini`, "variable absente ou vide"));
    else out.push(ok(`env.${name}`, `${name} est défini`));
  }
  if (env.APP_SECRET && env.APP_SECRET.length < 32) out.push(fail("env.APP_SECRET.length", "APP_SECRET fait au moins 32 caractères"));
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length < 32) out.push(fail("env.BETTER_AUTH_SECRET.length", "BETTER_AUTH_SECRET fait au moins 32 caractères"));
  if (env.APP_SECRET && env.BETTER_AUTH_SECRET && env.APP_SECRET === env.BETTER_AUTH_SECRET) {
    out.push(fail("env.secrets.distinct", "APP_SECRET et BETTER_AUTH_SECRET sont distincts", "un même secret ne doit pas protéger les cookies de session et pseudonymiser les compteurs"));
  }
  if (!env.CRON_SECRET) out.push(warn("env.CRON_SECRET", "CRON_SECRET défini", "absent : la purge de rétention planifiée est désactivée (obligatoire avant des données réelles)"));
  else if (env.CRON_SECRET.length < 32) out.push(fail("env.CRON_SECRET.length", "CRON_SECRET fait au moins 32 caractères"));
  if ((env.APP_ENV === "staging" || env.APP_ENV === "production") && !env.PLATFORM_ADMIN_EMAIL) out.push(fail("env.PLATFORM_ADMIN_EMAIL", "PLATFORM_ADMIN_EMAIL est défini", "obligatoire en staging et production : sans administrateur de la plateforme, aucune demande de club ne peut être approuvée"));
  if (env.APP_ENV === "production" && !opts.allowProduction) out.push(fail("env.APP_ENV", "APP_ENV n'est pas « production »", "ce contrôle est destiné à la préproduction ; ajouter --production pour un contrôle délibéré de la production"));
  else if (!["development", "test", "staging", "production"].includes(env.APP_ENV ?? "")) out.push(fail("env.APP_ENV", "APP_ENV identifie explicitement l'environnement", "obligatoire : development | test | staging | production (le serveur refuse de démarrer sinon)"));
  else out.push(ok("env.APP_ENV", `APP_ENV = ${env.APP_ENV}`));

  if (env.SITE_URL) {
    try {
      const site = new URL(env.SITE_URL);
      if (site.protocol !== "https:" && !opts.allowHttp) out.push(fail("env.SITE_URL.https", "SITE_URL utilise https", "obligatoire hors développement local : les cookies de session doivent être Secure"));
      else out.push(ok("env.SITE_URL.https", "SITE_URL utilise https (ou http toléré explicitement)"));
      if (isLocalHost(site.hostname) && !opts.allowHttp) out.push(fail("env.SITE_URL.public", "SITE_URL est une adresse publique", "localhost ne convient pas à un pilote"));
    } catch {
      out.push(fail("env.SITE_URL.valid", "SITE_URL est une URL valide"));
    }
  }

  // Aucune trace de l'ancienne architecture : aucune clé Supabase, aucune clé service_role.
  for (const name of Object.keys(env)) {
    if (/^SUPABASE_/i.test(name) && env[name]) out.push(warn("env.legacy_supabase", "aucune variable SUPABASE_* n'est configurée", `${name} est défini mais n'est plus utilisé : retirez-le`));
    if (/SERVICE_ROLE/i.test(name) && env[name]) out.push(fail("env.no_service_role", "aucune variable service_role n'est configurée", `${name} est défini : l'application n'en a pas besoin, retirez-le`));
  }

  // Deux connexions, deux rôles distincts et à privilèges minimaux.
  const app = env.DATABASE_URL ? dbUser(env.DATABASE_URL) : null;
  const auth = env.AUTH_DATABASE_URL ? dbUser(env.AUTH_DATABASE_URL) : null;
  if (env.DATABASE_URL && !app) out.push(fail("env.db.valid", "DATABASE_URL est une URL valide"));
  if (env.AUTH_DATABASE_URL && !auth) out.push(fail("env.authdb.valid", "AUTH_DATABASE_URL est une URL valide"));
  if (app) {
    if (!app.user.startsWith("app_server")) out.push(fail("env.db.user", "DATABASE_URL utilise le rôle app_server", `rôle « ${app.user.split(".")[0]} » : doit être app_server (jamais postgres)`));
    else out.push(ok("env.db.user", "DATABASE_URL utilise le rôle app_server"));
    const why = sslViolation(env.DATABASE_URL, { databaseSslDisabled: env.DATABASE_SSL === "disable" });
    if (why) out.push(fail("env.db.ssl", "SSL exigé pour DATABASE_URL", why));
    else out.push(ok("env.db.ssl", isLocalDatabaseUrl(env.DATABASE_URL) ? "DATABASE_URL locale (SSL non exigé)" : "DATABASE_URL exige SSL"));
  }
  if (auth) {
    if (!auth.user.startsWith("auth_runtime")) out.push(fail("env.authdb.user", "AUTH_DATABASE_URL utilise le rôle auth_runtime", `rôle « ${auth.user.split(".")[0]} » : doit être auth_runtime (jamais postgres ni app_server)`));
    else out.push(ok("env.authdb.user", "AUTH_DATABASE_URL utilise le rôle auth_runtime"));
    const whyAuth = sslViolation(env.AUTH_DATABASE_URL, { databaseSslDisabled: env.DATABASE_SSL === "disable" });
    if (whyAuth) out.push(fail("env.authdb.ssl", "SSL exigé pour AUTH_DATABASE_URL", whyAuth));
    else out.push(ok("env.authdb.ssl", isLocalDatabaseUrl(env.AUTH_DATABASE_URL) ? "AUTH_DATABASE_URL locale (SSL non exigé)" : "AUTH_DATABASE_URL exige SSL"));
  }

  // E-mails transactionnels : jamais la boîte d'envoi de test pour un vrai pilote.
  if (env.MAIL_PROVIDER === "outbox") {
    if (!opts.allowHttp) out.push(fail("env.mail.provider", "MAIL_PROVIDER est un vrai fournisseur", "« outbox » écrit les liens dans un fichier : réservé aux tests"));
  } else if (env.MAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) out.push(fail("env.mail.key", "RESEND_API_KEY est défini", "obligatoire avec MAIL_PROVIDER=resend (valeur dans le gestionnaire de secrets, jamais dans Git)"));
    if (!env.MAIL_FROM) out.push(fail("env.mail.from", "MAIL_FROM est défini", "adresse d'expédition d'un domaine vérifié"));
    if (env.RESEND_API_KEY && env.MAIL_FROM) out.push(ok("env.mail.provider", "MAIL_PROVIDER=resend configuré (clé et expéditeur présents)"));
  } else if (env.MAIL_PROVIDER) {
    out.push(fail("env.mail.provider", "MAIL_PROVIDER est connu", "valeurs acceptées : resend | outbox"));
  }
  return out;
}

/** Tables et fonctions que les migrations déclarent : elles doivent exister dans la base contrôlée. */
export function expectedObjects(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const tables = new Set();
  const functions = new Set();
  const privateFunctions = new Set();
  const authTables = new Set();
  const authFunctions = new Set();
  for (const f of files) {
    const sql = readFileSync(path.join(migrationsDir, f), "utf8");
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) tables.add(m[1]);
    for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)/gi)) functions.add(m[1]);
    // Une migration peut retirer une fonction (ex. create_academy, remplacée par la demande approuvée) : elle n'est alors plus attendue.
    for (const m of sql.matchAll(/drop function (?:if exists )?public\.(\w+)/gi)) functions.delete(m[1]);
    for (const m of sql.matchAll(/create (?:or replace )?function app_private\.(\w+)/gi)) privateFunctions.add(m[1]);
    for (const m of sql.matchAll(/create table (?:if not exists )?auth\.(\w+)/gi)) authTables.add(m[1]);
    for (const m of sql.matchAll(/create (?:or replace )?function auth\.(\w+)/gi)) authFunctions.add(m[1]);
  }
  return { files: files.map((f) => f.split("_")[0]), tables: [...tables], functions: [...functions], privateFunctions: [...privateFunctions], authTables: [...authTables], authFunctions: [...authFunctions] };
}

/**
 * Contrôles réels sur la base, avec la connexion `app_server` de l'application.
 * @param {import("postgres").Sql} sql @param {{ migrationsDir: string, remote?: boolean }} opts @returns {Promise<Check[]>}
 */
export async function checkDatabase(sql, opts) {
  /** @type {Check[]} */
  const out = [];
  const run = async (id, label, fn) => {
    try {
      out.push(await fn());
    } catch (e) {
      out.push(fail(id, label, `erreur : ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 160)}`));
    }
  };

  await run("db.connect", "connexion à PostgreSQL", async () => {
    const [r] = await sql`select current_user as u, session_user as s, current_setting('server_version') as v`;
    return ok("db.connect", "connexion à PostgreSQL", `rôle de session : ${r.s}, PostgreSQL ${r.v}`);
  });

  await run("db.version", "version de PostgreSQL supportée", async () => {
    const [r] = await sql`select current_setting('server_version_num')::int as num`;
    const v = assessPostgresVersion(r.num);
    if (v.level === "unsupported") return fail("db.version", "version de PostgreSQL supportée", v.message);
    if (v.level === "untested") return warn("db.version", "version de PostgreSQL testée", v.message);
    return ok("db.version", "version de PostgreSQL testée", v.message);
  });

  await run("db.role", "app_server : NOINHERIT, ni superuser ni BYPASSRLS", async () => {
    const [r] = await sql`select r.rolname, r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb from pg_roles r where r.rolname = session_user`;
    const problems = [];
    if (r.rolname !== "app_server") problems.push(`session_user = ${r.rolname} (attendu : app_server)`);
    if (r.rolinherit) problems.push("hérite des privilèges");
    if (r.rolsuper) problems.push("superuser");
    if (r.rolbypassrls) problems.push("BYPASSRLS");
    if (r.rolcreaterole || r.rolcreatedb) problems.push("peut créer des rôles/bases");
    return problems.length ? fail("db.role", "app_server : NOINHERIT, ni superuser ni BYPASSRLS", problems.join(" ; ")) : ok("db.role", "app_server : NOINHERIT, ni superuser ni BYPASSRLS");
  });

  await run("db.no_table_privileges", "app_server n'a aucun droit direct sur les tables", async () => {
    const rows = await sql`
      select n.nspname || '.' || c.relname as relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'auth') and c.relkind in ('r', 'p', 'v')
        and (has_table_privilege(session_user, c.oid, 'select') or has_table_privilege(session_user, c.oid, 'insert')
          or has_table_privilege(session_user, c.oid, 'update') or has_table_privilege(session_user, c.oid, 'delete'))`;
    return rows.length ? fail("db.no_table_privileges", "app_server n'a aucun droit direct sur les tables", `droits directs sur : ${rows.map((r) => r.relname).join(", ")}`) : ok("db.no_table_privileges", "app_server n'a aucun droit direct sur les tables");
  });

  await run("db.rls_enabled", "RLS activée sur toutes les tables de public", async () => {
    const rows = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    return rows.length ? fail("db.rls_enabled", "RLS activée sur toutes les tables de public", `sans RLS : ${rows.map((r) => r.relname).join(", ")}`) : ok("db.rls_enabled", "RLS activée sur toutes les tables de public");
  });

  await run("db.anon_closed", "le rôle anon n'a aucun accès aux tables ni aux fonctions", async () => {
    const t = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'auth') and c.relkind in ('r','p','v') and has_table_privilege('anon', c.oid, 'select,insert,update,delete')`;
    const f = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private','auth') and has_function_privilege('anon', p.oid, 'execute')`;
    const problems = [...t.map((r) => `table ${r.relname}`), ...f.map((r) => `fonction ${r.proname}`)];
    return problems.length ? fail("db.anon_closed", "le rôle anon n'a aucun accès aux tables ni aux fonctions", problems.join(", ")) : ok("db.anon_closed", "le rôle anon n'a aucun accès aux tables ni aux fonctions");
  });

  await run("db.set_role", "SET LOCAL ROLE authenticated + claims fonctionnent (compatible pooler transactionnel)", async () => {
    const uid = randomUUID();
    const r = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true), set_config('request.jwt.claim.sub', ${uid}, true), set_config('role', 'authenticated', true)`;
      const [row] = await tx`select current_user as u, auth.uid()::text as uid`;
      return row;
    });
    return r.u === "authenticated" && r.uid === uid
      ? ok("db.set_role", "SET LOCAL ROLE authenticated + claims fonctionnent (compatible pooler transactionnel)")
      : fail("db.set_role", "SET LOCAL ROLE authenticated + claims fonctionnent", `current_user=${r.u}, auth.uid()=${r.uid === uid ? "ok" : "incorrect"}`);
  });

  await run("db.rls_blocks", "un utilisateur inconnu ne lit rien et ne peut rien écrire", async () => {
    const uid = randomUUID();
    const result = await sql
      .begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true), set_config('request.jwt.claim.sub', ${uid}, true), set_config('role', 'authenticated', true)`;
        const [{ n }] = await tx`select (select count(*) from public.people)::int + (select count(*) from public.academies)::int + (select count(*) from public.attendance)::int as n`;
        let insertDenied = false;
        try {
          await tx`savepoint s`;
          await tx`insert into public.people (academy_id, first_name, last_name) values (${randomUUID()}, 'x', 'y')`;
        } catch (e) {
          insertDenied = e.code === "42501" || e.code === "23503";
          await tx`rollback to savepoint s`;
        }
        throw Object.assign(new Error("rollback"), { n, insertDenied });
      })
      .catch((e) => (e.message === "rollback" ? e : Promise.reject(e)));
    return result.n === 0 && result.insertDenied
      ? ok("db.rls_blocks", "un utilisateur inconnu ne lit rien et ne peut rien écrire")
      : fail("db.rls_blocks", "un utilisateur inconnu ne lit rien et ne peut rien écrire", `lignes visibles : ${result.n}, insertion refusée : ${result.insertDenied}`);
  });

  await run("db.migrations", "toutes les migrations sont appliquées (tables et fonctions attendues)", async () => {
    const exp = expectedObjects(opts.migrationsDir);
    const tables = new Set((await sql`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename));
    const funcs = new Set((await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`).map((r) => r.proname));
    const inSchema = async (schema) => new Set((await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${schema}`).map((r) => r.proname));
    const privateFuncs = await inSchema("app_private");
    const authFuncs = await inSchema("auth");
    const authTabs = new Set((await sql`select tablename from pg_tables where schemaname = 'auth'`).map((r) => r.tablename));
    const missing = [
      ...exp.tables.filter((t) => !tables.has(t)).map((t) => `table ${t}`),
      ...exp.functions.filter((f) => !funcs.has(f)).map((f) => `fonction ${f}`),
      ...exp.privateFunctions.filter((f) => !privateFuncs.has(f)).map((f) => `fonction app_private.${f}`),
      ...exp.authTables.filter((t) => !authTabs.has(t)).map((t) => `table auth.${t}`),
      ...exp.authFunctions.filter((f) => !authFuncs.has(f)).map((f) => `fonction auth.${f}`),
    ];
    const total = exp.tables.length + exp.functions.length + exp.privateFunctions.length + exp.authTables.length + exp.authFunctions.length;
    return missing.length ? fail("db.migrations", "toutes les migrations sont appliquées", `manquants : ${missing.join(", ")}`) : ok("db.migrations", "toutes les migrations sont appliquées (tables et fonctions attendues)", `${exp.files.length} migrations, ${total} objets vérifiés`);
  });

  await run("db.ssl", "connexion chiffrée (SSL)", async () => {
    const rows = await sql`select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
    const on = rows[0]?.ssl === true;
    if (on) return ok("db.ssl", "connexion chiffrée (SSL)");
    return opts.remote ? fail("db.ssl", "connexion chiffrée (SSL)", "base distante sans SSL") : warn("db.ssl", "connexion chiffrée (SSL)", "non chiffrée (acceptable uniquement en local)");
  });

  return out;
}

/**
 * Contrôles réels avec la connexion `auth_runtime` de Better Auth : droits minimaux et fermeture des tables d'authentification.
 * @param {import("postgres").Sql} sql @returns {Promise<Check[]>}
 */
export async function checkAuthDatabase(sql, opts = {}) {
  /** @type {Check[]} */
  const out = [];
  const run = async (id, label, fn) => {
    try {
      out.push(await fn());
    } catch (e) {
      out.push(fail(id, label, `erreur : ${e?.code ?? ""} ${String(e?.message ?? e).slice(0, 160)}`));
    }
  };

  await run("auth.role", "auth_runtime : ni superuser, ni BYPASSRLS, ni création de rôles/bases", async () => {
    const [r] = await sql`select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = session_user`;
    const problems = [];
    if (r.rolname !== "auth_runtime") problems.push(`session_user = ${r.rolname} (attendu : auth_runtime)`);
    if (r.rolsuper) problems.push("superuser");
    if (r.rolbypassrls) problems.push("BYPASSRLS");
    if (r.rolcreaterole || r.rolcreatedb) problems.push("peut créer des rôles/bases");
    return problems.length ? fail("auth.role", "auth_runtime : ni superuser, ni BYPASSRLS, ni création de rôles/bases", problems.join(" ; ")) : ok("auth.role", "auth_runtime : ni superuser, ni BYPASSRLS, ni création de rôles/bases");
  });

  await run("auth.no_business_access", "auth_runtime n'a aucun droit sur les données métier (public, app_private)", async () => {
    const rows = await sql`
      select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p', 'v')
        and (has_table_privilege(session_user, c.oid, 'select') or has_table_privilege(session_user, c.oid, 'insert')
          or has_table_privilege(session_user, c.oid, 'update') or has_table_privilege(session_user, c.oid, 'delete'))`;
    return rows.length ? fail("auth.no_business_access", "auth_runtime n'a aucun droit sur les données métier", `droits sur : ${rows.map((r) => r.t).join(", ")}`) : ok("auth.no_business_access", "auth_runtime n'a aucun droit sur les données métier (public, app_private)");
  });

  await run("auth.no_ddl", "auth_runtime ne peut créer aucun objet (schémas auth et public)", async () => {
    const [r] = await sql`select has_schema_privilege(session_user, 'auth', 'create') as a, has_schema_privilege(session_user, 'public', 'create') as p`;
    return r.a || r.p ? fail("auth.no_ddl", "auth_runtime ne peut créer aucun objet", "droit CREATE présent") : ok("auth.no_ddl", "auth_runtime ne peut créer aucun objet (schémas auth et public)");
  });

  await run("auth.tables", "les tables d'authentification existent et auth_runtime y accède", async () => {
    const need = ["users", "sessions", "accounts", "verifications"];
    const rows = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relkind = 'r'`;
    const have = new Set(rows.map((r) => r.relname));
    const missing = need.filter((t) => !have.has(t));
    if (missing.length) return fail("auth.tables", "les tables d'authentification existent", `manquantes : ${missing.join(", ")}`);
    await sql`select 1 from auth.users limit 1`;
    return ok("auth.tables", "les tables d'authentification existent et auth_runtime y accède");
  });

  await run("auth.ssl", "connexion chiffrée (SSL) pour auth_runtime", async () => {
    const rows = await sql`select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
    if (rows[0]?.ssl === true) return ok("auth.ssl", "connexion chiffrée (SSL) pour auth_runtime");
    return opts.remote ? fail("auth.ssl", "connexion chiffrée (SSL) pour auth_runtime", "base distante sans SSL") : warn("auth.ssl", "connexion chiffrée (SSL) pour auth_runtime", "non chiffrée (acceptable uniquement en local)");
  });

  await run("auth.closed", "aucun autre rôle applicatif n'a de droit sur les tables d'authentification", async () => {
    const leaks = [];
    for (const role of ["anon", "authenticated", "app_server"]) {
      for (const t of ["users", "sessions", "accounts", "verifications"]) {
        const [r] = await sql`select has_table_privilege(${role}, ${"auth." + t}, 'select,insert,update,delete') as p`;
        if (r.p) leaks.push(`${role}:${t}`);
      }
    }
    return leaks.length ? fail("auth.closed", "aucun autre rôle applicatif n'a de droit sur les tables d'authentification", leaks.join(", ")) : ok("auth.closed", "aucun autre rôle applicatif n'a de droit sur les tables d'authentification");
  });

  return out;
}

/**
 * Suivi des migrations, lu avec la connexion ADMINISTRATEUR (MIGRATION_DATABASE_URL) : app_server ne peut pas lire le schéma de suivi.
 * @param {import("postgres").Sql} sql @param {string} migrationsDir @returns {Promise<Check[]>}
 */
export async function checkMigrationTracking(sql, migrationsDir) {
  try {
    const files = loadMigrations(migrationsDir);
    const applied = await readApplied(sql);
    if (applied.length === 0) return [fail("migrations.tracking", "migrations suivies par le lanceur", "aucune migration suivie : appliquer `npm run db:migrate`")];
    const pending = planMigrations(applied, files);
    return pending.length
      ? [fail("migrations.tracking", "toutes les migrations sont appliquées et inchangées", `en attente : ${pending.map((p) => p.name).join(", ")}`)]
      : [ok("migrations.tracking", "toutes les migrations sont appliquées et inchangées (empreintes vérifiées)", `${applied.length} migrations suivies`)];
  } catch (e) {
    return [fail("migrations.tracking", "toutes les migrations sont appliquées et inchangées", String(e?.message ?? e).slice(0, 200))];
  }
}

export function summarize(checks) {
  return { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length };
}
