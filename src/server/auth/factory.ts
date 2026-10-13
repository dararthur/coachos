import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";
import { passwordResetEmail, verificationEmail } from "@/server/mail/templates";
import type { Mailer } from "@/server/mail/types";

/**
 * Better Auth pour Coach OS — configuration pure (aucune dépendance à Next.js) : la même fabrique sert l'application
 * (src/server/auth/auth.ts) et les tests (tests/db/auth-*.test.ts). Voir docs/self-hosted-auth.md.
 */

export interface Limiter {
  /** Pseudonyme HMAC (32 hex) : aucune IP ni adresse e-mail en clair dans les clés ni dans les sessions. */
  pseudonym(raw: string): string;
  /** true si l'appel est autorisé. Doit échouer FERMÉ (lever en cas d'erreur de base). */
  hit(scope: string, raw: string, max: number, windowSeconds: number): Promise<boolean>;
}

export interface AuthOptions {
  pool: Pool;
  mailer: Mailer;
  limiter: Limiter;
  secret: string;
  /** Origine publique exacte de l'application (SITE_URL). */
  baseURL: string;
  plugins?: BetterAuthPlugin[];
  /** Durées de vie en secondes (tests : valeurs courtes pour prouver l'expiration). Défauts : 24 h / 1 h. */
  verifyTtl?: number;
  resetTtl?: number;
  /** Journal d'incident d'envoi : jamais d'adresse, de jeton ni d'URL. */
  onMailError?: (kind: "verification" | "password_reset") => void;
  /** TESTS UNIQUEMENT : désactive les rafales par défaut de Better Auth pour isoler les règles du hook. */
  disableBuiltinBurst?: boolean;
}

/** En-tête de l'IP du client, posé (et ÉCRASÉ) par le reverse proxy de confiance — jamais fourni par le client. */
export const CLIENT_IP_HEADER = "x-real-ip";

interface Rule {
  scope: string;
  ip?: { max: number; window: number };
  email?: { max: number; window: number };
}

/**
 * Limites par action, alignées sur `LIMITS` (src/server/rate-limit.ts). La limite par e-mail s'applique que le compte
 * existe ou non : aucune différence observable. Le hook s'exécute pour TOUT appel d'endpoint : HTTP ET `auth.api.*`.
 */
export const RULES: Record<string, Rule> = {
  "/sign-in/email": { scope: "login", ip: { max: 30, window: 900 }, email: { max: 10, window: 900 } },
  "/sign-up/email": { scope: "signup", ip: { max: 5, window: 3600 } },
  "/request-password-reset": { scope: "reset", ip: { max: 5, window: 3600 }, email: { max: 3, window: 3600 } },
  "/send-verification-email": { scope: "verify-mail", ip: { max: 5, window: 3600 }, email: { max: 3, window: 3600 } },
  "/reset-password": { scope: "reset-token", ip: { max: 10, window: 900 } },
  "/change-password": { scope: "change-password", ip: { max: 10, window: 900 } },
  "/verify-email": { scope: "verify-link", ip: { max: 30, window: 900 } },
};

/** Surface HTTP minimale : Coach OS n'utilise ni connexion sociale, ni changement d'e-mail, ni suppression via Better Auth. */
export const DISABLED_PATHS = [
  "/sign-in/social",
  "/link-social",
  "/unlink-account",
  "/callback/:id",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
  "/list-accounts",
  "/change-email",
  "/update-session",
  "/delete-user",
  "/delete-user/callback",
  "/verify-password",
  "/get-session",
];

const SENSITIVE = /([^\s@]+@[^\s@]+|[A-Za-z0-9_-]{24,}|\b\d{1,3}(\.\d{1,3}){3}\b)/g;

/** Journal : niveau + message assaini + code d'erreur éventuel. Jamais la trace, la requête SQL ni les arguments. */
export function safeLog(level: string, message: string, ...args: unknown[]): void {
  const clean = String(message).replace(/[\r\n\t]+/g, " ").replace(SENSITIVE, "<masqué>").slice(0, 200);
  const codes = args
    .map((a) => (a && typeof a === "object" && "code" in a && typeof (a as { code: unknown }).code === "string" ? (a as { code: string }).code : null))
    .filter((c): c is string => Boolean(c && /^[A-Za-z0-9_.-]{1,40}$/.test(c)));
  const line = JSON.stringify({ t: new Date().toISOString(), level: level === "error" ? "error" : "warn", event: "auth.log", message: clean, code: codes[0] });
  if (level === "error") console.error(line);
  else console.warn(line);
}

export function createAuth(o: AuthOptions) {
  const { limiter } = o;
  return betterAuth({
    baseURL: o.baseURL,
    secret: o.secret,
    database: o.pool,
    telemetry: { enabled: false },
    logger: { level: "warn", log: (level, message, ...args) => safeLog(level, message, ...args) },
    disabledPaths: DISABLED_PATHS,
    user: {
      modelName: "users",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
    },
    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at", ipAddress: "ip_address", userAgent: "user_agent", userId: "user_id" },
    },
    account: {
      modelName: "accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
      // Les jetons de réinitialisation ne sont plus lisibles en base (identifiant haché) — mécanisme documenté.
      storeIdentifier: "hashed",
    },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: o.resetTtl ?? 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // Pas d'attente de l'envoi (anti-timing : la réponse ne révèle pas si le compte existe).
      sendResetPassword: async ({ user, url }) => {
        void o.mailer.send(passwordResetEmail(user.email, url)).catch(() => o.onMailError?.("password_reset"));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      // Pas de connexion automatique : le lien est rejouable pendant sa durée de vie (JWT), il ne doit donc jamais ouvrir de session.
      autoSignInAfterVerification: false,
      expiresIn: o.verifyTtl ?? 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        void o.mailer.send(verificationEmail(user.email, url)).catch(() => o.onMailError?.("verification"));
      },
    },
    // Filet générique de Better Auth (par IP et chemin) : clés pseudonymisées par HMAC, compteur atomique en base.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: o.disableBuiltinBurst ? Object.fromEntries(Object.keys(RULES).map((p) => [p, false as const])) : undefined,
      customStorage: {
        consume: async (key, rule) => {
          const cut = key.lastIndexOf("|");
          const ip = cut === -1 ? key : key.slice(0, cut);
          const route = cut === -1 ? "" : key.slice(cut + 1);
          const allowed = await limiter.hit(`ba${route}`, ip, rule.max, rule.window);
          return { allowed, retryAfter: allowed ? null : rule.window };
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const rule = RULES[ctx.path];
        if (!rule) return;
        const ip = ctx.headers?.get(CLIENT_IP_HEADER)?.trim() || "unknown";
        const body = ctx.body as { email?: unknown } | undefined;
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
        const checks: Promise<boolean>[] = [];
        if (rule.ip) checks.push(limiter.hit(`${rule.scope}:ip`, ip, rule.ip.max, rule.ip.window));
        if (rule.email && email) checks.push(limiter.hit(`${rule.scope}:email`, email, rule.email.max, rule.email.window));
        if ((await Promise.all(checks)).includes(false)) throw new APIError("TOO_MANY_REQUESTS", { message: "Too many requests. Please try again later." });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // L'adresse IP n'est conservée que sous forme pseudonymisée (HMAC).
          before: async (session) => ({
            data: { ...session, ipAddress: session.ipAddress ? limiter.pseudonym(session.ipAddress) : session.ipAddress },
          }),
        },
      },
    },
    plugins: o.plugins ?? [],
  });
}

export type CoachAuth = ReturnType<typeof createAuth>;
