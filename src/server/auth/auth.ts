import "server-only";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { getMailer } from "@/server/mail";
import { env } from "@/server/env";
import { hitRateLimit, pseudonym } from "@/server/rate-limit";
import { createAuth, type CoachAuth } from "./factory";

const globalForAuth = globalThis as unknown as { __coachosAuth?: CoachAuth };

/** Instance unique de Better Auth (rôle PostgreSQL `auth_runtime` : DML sur auth.* uniquement). */
export function getAuth(): CoachAuth {
  if (globalForAuth.__coachosAuth) return globalForAuth.__coachosAuth;
  const e = env();
  const pool = new Pool({ connectionString: e.AUTH_DATABASE_URL, options: "-c search_path=auth", max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000 });
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
