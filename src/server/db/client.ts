import "server-only";
import postgres from "postgres";
import { AppError, isErrorCode, type ErrorCode } from "@/domain/errors";

/**
 * Accès PostgreSQL.
 *
 * Le serveur se connecte avec le rôle `app_server`, qui n'a AUCUN droit sur les tables. Chaque requête
 * utilisateur s'exécute dans une transaction qui fait `SET LOCAL ROLE authenticated` et pose les claims
 * JWT de l'utilisateur vérifié : la RLS de PostgreSQL est donc la seule autorité d'accès aux données.
 * Oublier d'appeler `withUser` produit une erreur « permission denied », jamais une fuite.
 */

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface DbUser {
  id: string;
  email?: string | null;
}

const globalForDb = globalThis as unknown as { __coachosSql?: Sql };

function createClient(url: string): Sql {
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    // Compatible pooler transactionnel (Supabase Supavisor / pgbouncer).
    prepare: false,
    onnotice: () => {},
    // Les `date` restent des chaînes YYYY-MM-DD : aucune conversion de fuseau implicite.
    types: {
      date: { to: 1082, from: [1082], serialize: (v: unknown) => String(v), parse: (v: string) => v },
    },
    ssl: process.env.DATABASE_SSL === "disable" ? false : undefined,
  });
}

export function getSql(): Sql {
  if (!globalForDb.__coachosSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL n'est pas défini.");
    globalForDb.__coachosSql = createClient(url);
  }
  return globalForDb.__coachosSql;
}

/** Pour les tests : client explicite sur une URL donnée. */
export function createTestClient(url: string): Sql {
  return createClient(url);
}

/**
 * Exécute `fn` dans une transaction soumise à la RLS, en tant qu'utilisateur authentifié `user`.
 * `sql` est injectable pour les tests ; en production c'est le client global.
 */
export async function withUser<T>(user: DbUser, fn: (tx: Tx) => Promise<T>, sql: Sql = getSql()): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(user.id)) throw new AppError("not_authenticated");
  const claims = JSON.stringify({ sub: user.id, role: "authenticated", email: user.email ?? undefined });
  try {
    return (await sql.begin(async (tx) => {
      await tx`select
        set_config('request.jwt.claims', ${claims}, true),
        set_config('request.jwt.claim.sub', ${user.id}, true),
        set_config('statement_timeout', '15000', true),
        set_config('role', 'authenticated', true)`;
      return fn(tx);
    })) as T;
  } catch (error) {
    throw mapDbError(error);
  }
}

/** Pour les rares opérations hors utilisateur (limitation de débit, purge) : rôle `app_server` nu. */
export async function withApp<T>(fn: (tx: Tx) => Promise<T>, sql: Sql = getSql()): Promise<T> {
  try {
    return (await sql.begin(async (tx) => {
      await tx`select set_config('statement_timeout', '15000', true)`;
      return fn(tx);
    })) as T;
  } catch (error) {
    throw mapDbError(error);
  }
}

interface PgErrorLike {
  code?: string;
  message?: string;
  constraint_name?: string;
}

/** Traduit une erreur PostgreSQL en AppError sûre ; ne laisse jamais fuiter le SQL ni les noms de colonnes. */
export function mapDbError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const pg = error as PgErrorLike;
  const message = typeof pg?.message === "string" ? pg.message : "";
  if (message.startsWith("coachos:")) {
    const code = message.slice("coachos:".length).trim();
    if (isErrorCode(code)) return new AppError(code, { cause: error });
  }
  const byState: Record<string, ErrorCode> = {
    "23505": "duplicate",
    "42501": "forbidden",
    "28000": "not_authenticated",
    "P0002": "not_found",
    "23514": "validation",
    "22P02": "validation",
    "22007": "validation",
    "22008": "validation",
    "23503": "validation",
  };
  const code = pg?.code ? byState[pg.code] : undefined;
  if (code === "validation" && pg?.code === "23503" && /attendance/.test(pg.constraint_name ?? "")) {
    return new AppError("session_has_attendance", { cause: error });
  }
  return new AppError(code ?? "internal", { cause: error });
}
