import "server-only";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { getMailer } from "@/server/mail";
import { env } from "@/server/env";
import { hitRateLimit, pseudonym } from "@/server/rate-limit";
import { createAuth, type CoachAuth } from "./factory";

const globalForAuth = globalThis as unknown as { __coachosAuth?: CoachAuth; __coachosAuthPool?: Pool };

/** Pool unique du rôle `auth_runtime` (partagé par Better Auth et la sonde de disponibilité). */
export function getAuthPool(): Pool {
  if (globalForAuth.__coachosAuthPool) return globalForAuth.__coachosAuthPool;
  const pool = new Pool({ connectionString: env().AUTH_DATABASE_URL, options: "-c search_path=auth", max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000 });
  // Une erreur sur une connexion inactive (base redémarrée) ne doit jamais arrêter le processus.
  pool.on("error", () => {});
  globalForAuth.__coachosAuthPool = pool;
  return pool;
}

/** Instance unique de Better Auth (rôle PostgreSQL `auth_runtime` : DML sur auth.* uniquement). */
export function getAuth(): CoachAuth {
  if (globalForAuth.__coachosAuth) return globalForAuth.__coachosAuth;
  const e = env();
  const pool = getAuthPool();
  globalForAuth.__coachosAuth = createAuth({
    pool,
    mailer: getMailer(),
    limiter: { pseudonym, hit: hitRateLimit },
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.SITE_URL,
    plugins: [nextCookies()], // doit rester le dernier plugin
    onMailError: (kind) => console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", event: "auth.mail_failed", kind })),
  });
  return globalForAuth.__coachosAuth;
}
