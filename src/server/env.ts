import "server-only";
import { z } from "zod";

/** Variables d'environnement validées au premier usage. Voir .env.example (aucune valeur secrète versionnée). */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
    /** E-mails transactionnels : `resend` (production) ou `outbox` (tests : liens écrits dans un fichier). */
    MAIL_PROVIDER: z.enum(["resend", "outbox"]),
    RESEND_API_KEY: z.string().min(8).optional(),
    MAIL_FROM: z.string().min(5).optional(),
    MAIL_OUTBOX_FILE: z.string().min(1).optional(),
    /** Durée de vie d'un jeton de pointage QR (secondes, 10–300 ; défaut 90). */
    CHECKIN_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).max(300).optional(),
    /** Jeton de la tâche planifiée de purge (optionnel : sans lui, la route de purge est désactivée). */
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.APP_SECRET === v.BETTER_AUTH_SECRET) ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "distinct d'APP_SECRET" });
    if (v.MAIL_PROVIDER === "resend") {
      if (!v.RESEND_API_KEY) ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "requis avec MAIL_PROVIDER=resend" });
      if (!v.MAIL_FROM) ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "requis avec MAIL_PROVIDER=resend" });
    }
    if (v.MAIL_PROVIDER === "outbox" && !v.MAIL_OUTBOX_FILE) ctx.addIssue({ code: "custom", path: ["MAIL_OUTBOX_FILE"], message: "requis avec MAIL_PROVIDER=outbox" });
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // On ne liste que les noms des variables fautives, jamais leurs valeurs.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Configuration invalide ou incomplète : ${names}. Voir .env.example.`);
  }
  const site = new URL(parsed.data.SITE_URL);
  const loopback = site.hostname === "localhost" || site.hostname === "127.0.0.1";
  if (parsed.data.NODE_ENV === "production" && site.protocol !== "https:" && !loopback) {
    throw new Error("SITE_URL doit utiliser https en production (seul le loopback est toléré, pour les tests locaux).");
  }
  cached = parsed.data;
  return cached;
}
