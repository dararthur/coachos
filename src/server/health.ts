/**
 * Disponibilité (readiness) : le service n'est « prêt » que si ses dépendances ESSENTIELLES répondent et ont les droits attendus.
 * Distinct de /api/live (processus vivant, aucune dépendance). La réponse publique ne détaille JAMAIS la cause (ni hôte, ni message
 * d'erreur) ; le détail va dans un journal structuré sans secret (noms de contrôles seulement).
 */
export type Probe = () => Promise<void>;
export type Probes = Record<string, Probe>;
export interface Readiness {
  ok: boolean;
  failed: string[];
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

/** Exécute toutes les sondes en parallèle ; une sonde qui échoue, lève ou dépasse le délai rend le service indisponible. */
export async function runReadiness(probes: Probes, timeoutMs = 3000): Promise<Readiness> {
  const failed: string[] = [];
  await Promise.all(
    Object.entries(probes).map(async ([name, probe]) => {
      try {
        await withTimeout(Promise.resolve().then(probe), timeoutMs);
      } catch {
        failed.push(name);
      }
    }),
  );
  failed.sort();
  return { ok: failed.length === 0, failed };
}

/** Sondes réelles. Imports dynamiques : une configuration invalide devient un échec de la sonde, pas une erreur de chargement. */
export function defaultProbes(): Probes {
  return {
    config: async () => {
      const { env } = await import("@/server/env");
      env();
    },
    app_db: async () => {
      // Même chemin qu'une requête utilisateur : rôle app_server → rôle authenticated, et droit réel sur une table métier (RLS comprise).
      const { getSql } = await import("@/server/db/client");
      await getSql().begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true)`;
        await tx`select 1 from public.academies limit 0`;
      });
    },
    auth_db: async () => {
      // Rôle auth_runtime : droit de lecture sur les tables d'authentification (privilèges de la migration 0007 comprises).
      const { getAuthPool } = await import("@/server/auth/auth");
      await getAuthPool().query("select 1 from auth.users limit 0");
    },
  };
}

let cache: { at: number; value: Readiness } | undefined;
const TTL_MS = 3000;

/** Résultat mémorisé quelques secondes : une rafale de sondes ne multiplie pas les connexions à la base. Un échec n'est jamais gardé plus longtemps. */
export async function readiness(probes: Probes = defaultProbes(), now = Date.now()): Promise<Readiness> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const value = await runReadiness(probes);
  cache = { at: now, value };
  return value;
}

export function resetReadinessCache() {
  cache = undefined;
}
