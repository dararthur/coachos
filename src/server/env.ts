import "server-only";
import { z } from "zod";
import { sslViolation } from "./db-url";

/**
 * Variables d'environnement. Validées AU DÉMARRAGE du serveur (src/instrumentation.ts), pas au premier appel métier :
 * une configuration absente, incohérente ou interdite empêche le processus de démarrer. Voir .env.example.
 */

/** Environnements d'exécution. `test` et `development` sont les seuls où la boîte d'envoi d'e-mails de test est tolérée. */
export const APP_ENVS = ["development", "test", "staging", "production"] as const;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /**
     * Rôle EXPLICITE de cette instance. `NODE_ENV=production` ne suffit pas : les tests e2e tournent aussi en mode production.
     * Ne jamais laisser une valeur par défaut : une instance dont le rôle est inconnu ne démarre pas.
     */
    APP_ENV: z.enum(APP_ENVS),
    /** Connexion du rôle `app_server` (données métier, RLS). */
    DATABASE_URL: z.string().min(10),
    /** Connexion du rôle `auth_runtime` (tables d'authentification de Better Auth uniquement). */
    AUTH_DATABASE_URL: z.string().min(10),
    /** URL publique exacte (origine de confiance de Better Auth, liens d'e-mail). https obligatoire en production. */
    SITE_URL: z.url(),
    /** Pseudonymise les adresses IP et e-mails dans les compteurs anti-abus et dans auth.sessions. */
    APP_SECRET: z.string().min(32),
    /** Signe les cookies de session (HMAC). Distinct d'APP_SECRET ; jamais stocké avec la base ni ses sauvegardes. */
    BETTER_AUTH_SECRET: z.string().min(32),
    /** E-mails transactionnels : `resend` (staging, production) ou `outbox` (développement et tests UNIQUEMENT : liens écrits dans un fichier). */
    MAIL_PROVIDER: z.enum(["resend", "outbox"]),
    RESEND_API_KEY: z.string().min(8).optional(),
    MAIL_FROM: z.string().min(5).optional(),
    MAIL_OUTBOX_FILE: z.string().min(1).optional(),
    /** Durée HSTS en secondes (0–31 536 000). Défaut : staging 300, production 86 400. Voir docs/nginx.md. */
    HSTS_MAX_AGE_SECONDS: z.coerce.number().int().min(0).max(31_536_000).optional(),
    /** `disable` : seulement pour une base locale sans SSL (interdit pour une base distante en staging/production). */
    DATABASE_SSL: z.string().optional(),
    /** Durée de vie d'un jeton de pointage QR (secondes, 10–300 ; défaut 90). */
    CHECKIN_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).max(300).optional(),
    /** Jeton de la tâche planifiée de purge (optionnel : sans lui, la route de purge est désactivée). */
    CRON_SECRET: z.string().min(32).optional(),
    /**
     * Adresse de l'administrateur de la plateforme : reçoit les demandes de création de club, peut seule les approuver, et peut créer
     * son compte sans ticket. Lue UNIQUEMENT ici (serveur) : jamais en base, jamais envoyée au navigateur, jamais écrite dans un journal,
     * une URL ou un message d'erreur.
     */
    PLATFORM_ADMIN_EMAIL: z.email().max(254).optional(),
    /**
     * Notifications push (Web Push, clés VAPID — générées une fois par `node scripts/generate-vapid.mjs`). Les trois ensemble ou aucune :
     * sans elles, la fonction est désactivée et n'apparaît nulle part. La clé publique est destinée au navigateur ; la privée ne quitte jamais le serveur.
     */
    VAPID_PUBLIC_KEY: z.string().min(80).max(100).optional(),
    VAPID_PRIVATE_KEY: z.string().min(40).max(60).optional(),
    VAPID_SUBJECT: z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if ((v.APP_ENV === "staging" || v.APP_ENV === "production") && !v.PLATFORM_ADMIN_EMAIL) {
      issue("PLATFORM_ADMIN_EMAIL", `requis avec APP_ENV=${v.APP_ENV} (sans administrateur, aucune demande de club ne peut être approuvée)`);
    }
    const vapid = [v.VAPID_PUBLIC_KEY, v.VAPID_PRIVATE_KEY, v.VAPID_SUBJECT].filter(Boolean).length;
    if (vapid !== 0 && vapid !== 3) issue("VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT vont ensemble");
    if (v.APP_SECRET === v.BETTER_AUTH_SECRET) issue("BETTER_AUTH_SECRET", "doit être distinct d'APP_SECRET");
    if (v.MAIL_PROVIDER === "resend") {
      if (!v.RESEND_API_KEY) issue("RESEND_API_KEY", "requis avec MAIL_PROVIDER=resend");
      if (!v.MAIL_FROM) issue("MAIL_FROM", "requis avec MAIL_PROVIDER=resend");
    }
    if (v.MAIL_PROVIDER === "outbox") {
      if (!v.MAIL_OUTBOX_FILE) issue("MAIL_OUTBOX_FILE", "requis avec MAIL_PROVIDER=outbox");
      // La boîte d'envoi écrit les liens de confirmation et de réinitialisation EN CLAIR dans un fichier et n'envoie rien :
      // elle n'existe que pour le développement et les tests, sur une instance qui n'est joignable que localement.
      if (v.APP_ENV === "staging" || v.APP_ENV === "production") {
        issue("MAIL_PROVIDER", `« outbox » est interdit avec APP_ENV=${v.APP_ENV} (utiliser resend)`);
      } else {
        let host = "";
        try {
          host = new URL(v.SITE_URL).hostname;
        } catch {
          /* SITE_URL invalide : déjà signalé */
        }
        if (!LOOPBACK_HOSTS.includes(host)) issue("MAIL_PROVIDER", "« outbox » exige une SITE_URL locale (localhost ou 127.0.0.1) : refusé pour une instance publique");
      }
    }
    // Une base DISTANTE exige SSL dans les instances déployées (la boucle locale et les sockets Unix en sont dispensés).
    if (v.APP_ENV === "staging" || v.APP_ENV === "production") {
      for (const name of ["DATABASE_URL", "AUTH_DATABASE_URL"] as const) {
        const why = sslViolation(v[name], { databaseSslDisabled: v.DATABASE_SSL === "disable" });
        if (why) issue(name, why);
      }
    }
    let protocol = "";
    try {
      protocol = new URL(v.SITE_URL).protocol;
    } catch {
      /* SITE_URL invalide : déjà signalé par le schéma */
    }
    if (v.APP_ENV === "production" && protocol !== "https:") issue("SITE_URL", "https obligatoire avec APP_ENV=production");
  });

export type Env = z.infer<typeof schema>;

/** Valide une configuration SANS la mémoriser (testable). Les messages ne contiennent jamais de valeur, seulement des noms de variables. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Une variable vide (`NOM=` dans un fichier copié de .env.example) équivaut à une variable absente.
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    // Les raisons des règles croisées sont écrites par nous (aucune valeur) ; celles de zod (types, tailles) sont omises.
    const reasons = parsed.error.issues.filter((i) => i.code === "custom").map((i) => `${String(i.path[0])} : ${i.message}`);
    throw new Error(`Configuration invalide ou incomplète : ${names}.${reasons.length ? ` ${reasons.join(" ; ")}.` : ""} Voir .env.example.`);
  }
  const site = new URL(parsed.data.SITE_URL);
  const loopback = LOOPBACK_HOSTS.includes(site.hostname);
  if (parsed.data.NODE_ENV === "production" && site.protocol !== "https:" && !loopback) {
    throw new Error("SITE_URL doit utiliser https en production (seul le loopback est toléré, pour les tests locaux).");
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
