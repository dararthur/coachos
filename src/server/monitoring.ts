import "server-only";
import type { JobId, Metric } from "@/domain/monitoring";
import { withApp, type Sql } from "@/server/db/client";
import { logger } from "@/server/logger";

/**
 * Écritures de supervision, « au mieux » : une panne de la base de supervision ne doit jamais faire échouer la tâche ni l'envoi qu'elle observe.
 * Aucune donnée personnelle : un nom de tâche, un succès ou un échec, un code d'erreur court ; un type d'événement et un nombre.
 */
export async function recordJob(job: JobId, ok: boolean, error?: string, sql?: Sql): Promise<void> {
  try {
    await withApp((tx) => tx`select app_private.job_record(${job}, ${ok}, ${error ?? null})`, sql);
  } catch {
    logger.warn("monitoring.job_record_failed", { job });
  }
}

export async function countMetric(metric: Metric, n = 1): Promise<void> {
  if (n <= 0) return;
  try {
    await withApp((tx) => tx`select app_private.counter_add(${metric}, ${n})`);
  } catch {
    logger.warn("monitoring.counter_failed", { metric });
  }
}

export async function purgePlatformCounters(): Promise<number> {
  const [row] = await withApp((tx) => tx<{ n: number }[]>`select app_private.purge_platform_counters() as n`);
  return row?.n ?? 0;
}
