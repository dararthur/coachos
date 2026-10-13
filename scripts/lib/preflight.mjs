// Contrôles de préproduction : configuration, connexion `app_server`, RLS, rôles et Supabase Auth.
// Ne lit jamais de donnée métier ; n'affiche jamais de valeur secrète (noms de variables et verdicts seulement).
// Réutilisé par scripts/pilot-preflight.mjs et testé contre un vrai PostgreSQL dans tests/db/preflight.test.ts.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** @typedef {{ id: string, label: string, status: "ok" | "fail" | "warn", detail?: string }} Check */
const ok = (id, label, detail) => ({ id, label, status: "ok", detail });
const fail = (id, label, detail) => ({ id, label, status: "fail", detail });
const warn = (id, label, detail) => ({ id, label, status: "warn", detail });

export const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL", "SITE_URL", "APP_SECRET"];
export const OPTIONAL_ENV = ["CRON_SECRET", "DATABASE_SSL", "DATABASE_POOL_SIZE", "CHECKIN_TOKEN_TTL_SECONDS", "APP_ENV"];

function jwtRole(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role ?? null;
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
  if (!env.CRON_SECRET) out.push(warn("env.CRON_SECRET", "CRON_SECRET défini", "absent : la purge de rétention planifiée est désactivée (obligatoire avant des données réelles)"));
  else if (env.CRON_SECRET.length < 32) out.push(fail("env.CRON_SECRET.length", "CRON_SECRET fait au moins 32 caractères"));
  if (env.APP_ENV === "production" && !opts.allowProduction) out.push(fail("env.APP_ENV", "APP_ENV n'est pas « production »", "ce contrôle est destiné à la préproduction ; ajouter --production pour un contrôle délibéré de la production"));
  else if (!env.APP_ENV) out.push(warn("env.APP_ENV", "APP_ENV identifie l'environnement", "définir APP_ENV=staging pour rendre l'environnement explicite"));
  else out.push(ok("env.APP_ENV", `APP_ENV = ${env.APP_ENV}`));

  if (env.SITE_URL) {
    try {
      const site = new URL(env.SITE_URL);
      const local = ["localhost", "127.0.0.1"].includes(site.hostname);
      if (site.protocol !== "https:" && !opts.allowHttp) out.push(fail("env.SITE_URL.https", "SITE_URL utilise https", "obligatoire hors développement local"));
      else out.push(ok("env.SITE_URL.https", "SITE_URL utilise https (ou http toléré explicitement)"));
      if (local && !opts.allowHttp) out.push(fail("env.SITE_URL.public", "SITE_URL est une adresse publique", "localhost ne convient pas à un pilote"));
    } catch {
      out.push(fail("env.SITE_URL.valid", "SITE_URL est une URL valide"));
    }
  }

  // La clé côté application doit être publique (anon/publishable) : jamais service_role / secrète.
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (key) {
    if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") out.push(fail("env.key.public", "SUPABASE_PUBLISHABLE_KEY est une clé publique", "clé SECRÈTE / service_role détectée : ne jamais la placer ici"));
    else out.push(ok("env.key.public", "SUPABASE_PUBLISHABLE_KEY n'est pas une clé service_role"));
  }
  for (const name of Object.keys(env)) {
    if (/SERVICE_ROLE/i.test(name) && env[name]) out.push(fail("env.no_service_role", "aucune variable service_role n'est configurée", `${name} est défini : l'application n'en a pas besoin, retirez-le`));
  }

  if (env.DATABASE_URL) {
    try {
      const db = new URL(env.DATABASE_URL);
      const user = decodeURIComponent(db.username);
      if (!user.startsWith("app_server")) out.push(fail("env.db.user", "DATABASE_URL utilise le rôle app_server", `rôle « ${user.split(".")[0]} » : doit être app_server (jamais postgres)`));
      else out.push(ok("env.db.user", "DATABASE_URL utilise le rôle app_server"));
      // Cohérence des projets : la référence du projet Supabase doit apparaître dans l'hôte ou l'utilisateur de la base.
      const supa = env.SUPABASE_URL ? new URL(env.SUPABASE_URL) : null;
      const ref = supa && supa.hostname.endsWith(".supabase.co") ? supa.hostname.split(".")[0] : null;
      if (ref) {
        if (db.hostname.includes(ref) || user.includes(ref)) out.push(ok("env.project_ref", "DATABASE_URL et SUPABASE_URL désignent le même projet"));
        else out.push(fail("env.project_ref", "DATABASE_URL et SUPABASE_URL désignent le même projet", "référence de projet absente de DATABASE_URL : risque de mélanger deux projets (ex. auth de préproduction + base de production)"));
      } else {
        out.push(warn("env.project_ref", "cohérence des projets non vérifiable", "SUPABASE_URL n'est pas de la forme <ref>.supabase.co (instance locale ou domaine personnalisé)"));
      }
      if (!["localhost", "127.0.0.1"].includes(db.hostname) && env.DATABASE_SSL === "disable") out.push(fail("env.db.ssl", "SSL de la base actif", "DATABASE_SSL=disable sur une base distante"));
    } catch {
      out.push(fail("env.db.valid", "DATABASE_URL est une URL valide"));
    }
  }
  return out;
}

/** Tables et fonctions que les migrations déclarent : elles doivent exister dans la base contrôlée. */
export function expectedObjects(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const tables = new Set();
  const functions = new Set();
  for (const f of files) {
    const sql = readFileSync(path.join(migrationsDir, f), "utf8");
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) tables.add(m[1]);
    for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)/gi)) functions.add(m[1]);
  }
  return { files: files.map((f) => f.split("_")[0]), tables: [...tables], functions: [...functions] };
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
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
        and (has_table_privilege(session_user, c.oid, 'select') or has_table_privilege(session_user, c.oid, 'insert')
          or has_table_privilege(session_user, c.oid, 'update') or has_table_privilege(session_user, c.oid, 'delete'))`;
    return rows.length ? fail("db.no_table_privileges", "app_server n'a aucun droit direct sur les tables", `droits directs sur : ${rows.map((r) => r.relname).join(", ")}`) : ok("db.no_table_privileges", "app_server n'a aucun droit direct sur les tables");
  });

  await run("db.rls_enabled", "RLS activée sur toutes les tables de public", async () => {
    const rows = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    return rows.length ? fail("db.rls_enabled", "RLS activée sur toutes les tables de public", `sans RLS : ${rows.map((r) => r.relname).join(", ")}`) : ok("db.rls_enabled", "RLS activée sur toutes les tables de public");
  });

  await run("db.anon_closed", "le rôle anon n'a aucun accès aux tables ni aux fonctions", async () => {
    const t = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v') and has_table_privilege('anon', c.oid, 'select,insert,update,delete')`;
    const f = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private') and has_function_privilege('anon', p.oid, 'execute')`;
    const problems = [...t.map((r) => `table ${r.relname}`), ...f.map((r) => `fonction ${r.proname}`)];
    return problems.length ? fail("db.anon_closed", "le rôle anon n'a aucun accès aux tables ni aux fonctions", problems.join(", ")) : ok("db.anon_closed", "le rôle anon n'a aucun accès aux tables ni aux fonctions");
  });

  await run("db.set_role", "SET LOCAL ROLE authenticated + claims JWT fonctionnent (compatible pooler transactionnel)", async () => {
    const uid = randomUUID();
    const r = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true), set_config('request.jwt.claim.sub', ${uid}, true), set_config('role', 'authenticated', true)`;
      const [row] = await tx`select current_user as u, auth.uid()::text as uid`;
      return row;
    });
    return r.u === "authenticated" && r.uid === uid
      ? ok("db.set_role", "SET LOCAL ROLE authenticated + claims JWT fonctionnent (compatible pooler transactionnel)")
      : fail("db.set_role", "SET LOCAL ROLE authenticated + claims JWT fonctionnent", `current_user=${r.u}, auth.uid()=${r.uid === uid ? "ok" : "incorrect"}`);
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
    const missing = [...exp.tables.filter((t) => !tables.has(t)).map((t) => `table ${t}`), ...exp.functions.filter((f) => !funcs.has(f)).map((f) => `fonction ${f}`)];
    return missing.length ? fail("db.migrations", "toutes les migrations sont appliquées", `manquants : ${missing.join(", ")}`) : ok("db.migrations", "toutes les migrations sont appliquées (tables et fonctions attendues)", `${exp.files.length} migrations, ${exp.tables.length} tables, ${exp.functions.length} fonctions`);
  });

  await run("db.ssl", "connexion chiffrée (SSL)", async () => {
    const rows = await sql`select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
    const on = rows[0]?.ssl === true;
    if (on) return ok("db.ssl", "connexion chiffrée (SSL)");
    return opts.remote ? fail("db.ssl", "connexion chiffrée (SSL)", "base distante sans SSL") : warn("db.ssl", "connexion chiffrée (SSL)", "non chiffrée (acceptable uniquement en local)");
  });

  return out;
}

/** Réglages publics de Supabase Auth (aucune clé secrète requise). @returns {Promise<Check[]>} */
export async function checkAuth(supabaseUrl, publishableKey, fetchImpl = fetch) {
  /** @type {Check[]} */
  const out = [];
  try {
    const res = await fetchImpl(new URL("/auth/v1/settings", supabaseUrl), { headers: { apikey: publishableKey }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [fail("auth.reachable", "Supabase Auth répond", `HTTP ${res.status} : clé ou URL invalide ?`)];
    const s = await res.json();
    out.push(ok("auth.reachable", "Supabase Auth répond"));
    out.push(s.mailer_autoconfirm === false ? ok("auth.confirm", "la confirmation d'e-mail est exigée") : fail("auth.confirm", "la confirmation d'e-mail est exigée", "mailer_autoconfirm est actif : n'importe qui peut créer un compte avec l'e-mail d'autrui et accepter ses invitations"));
    out.push(s.external?.email === true ? ok("auth.email", "l'authentification par e-mail est activée") : fail("auth.email", "l'authentification par e-mail est activée"));
    out.push(s.disable_signup === true ? warn("auth.signup", "inscriptions ouvertes", "les inscriptions sont désactivées : les adhérents ne pourront pas créer leur compte (inviter via Supabase) — voir docs/pilot.md") : ok("auth.signup", "les inscriptions sont ouvertes (nécessaire pour accepter une invitation)"));
  } catch (e) {
    out.push(fail("auth.reachable", "Supabase Auth répond", `erreur réseau : ${String(e?.message ?? e).slice(0, 120)}`));
  }
  return out;
}

export function summarize(checks) {
  return { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length };
}
