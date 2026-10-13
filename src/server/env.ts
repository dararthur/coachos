import "server-only";
import { z } from "zod";

/** Variables d'environnement validées au premier usage. Voir .env.example (aucune valeur secrète versionnée). */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_URL: z.url(),
  /** Clé « publishable » / anon : conçue pour être publique, n'ouvre rien sans JWT + RLS. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(10),
  SITE_URL: z.url(),
  /** Sert à pseudonymiser les adresses IP dans les compteurs de débit. */
  APP_SECRET: z.string().min(32),
  /** Jeton de la tâche planifiée de purge (optionnel : sans lui, la route de purge est désactivée). */
  CRON_SECRET: z.string().min(32).optional(),
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
  if (parsed.data.NODE_ENV === "production" && !parsed.data.SITE_URL.startsWith("https://")) {
    throw new Error("SITE_URL doit utiliser https en production.");
  }
  cached = parsed.data;
  return cached;
}
