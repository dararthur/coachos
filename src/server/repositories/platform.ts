import "server-only";
import type { JobRun, Metric } from "@/domain/monitoring";
import type { Tx } from "@/server/db/client";

export interface PlatformOverview {
  clubs: number;
  activeClubs30d: number;
  members: number;
  accounts: number;
  pendingRequests: number;
  events7d: number;
  events30d: number;
  byEvent: Record<string, number>;
  dbSizeBytes: number;
  dbVersion: string;
}

export interface PlatformClub {
  id: string;
  name: string;
  timezone: string;
  createdAt: Date;
  ownerEmail: string | null;
  members: number;
  staff: number;
  sessions30d: number;
  events7d: number;
  events30d: number;
  lastEventAt: Date | null;
  /** Modules coupés pour ce club (identifiants de FEATURES). */
  disabledFeatures: string[];
}

/** Chiffres globaux de la plateforme. Réservé à l'administrateur de la plateforme (la fonction refuse tout autre compte). */
export async function platformOverview(tx: Tx): Promise<PlatformOverview> {
  const [row] = await tx<(Omit<PlatformOverview, "dbSizeBytes"> & { dbSizeBytes: string })[]>`
    select clubs, active_clubs_30d as "activeClubs30d", members, accounts, pending_requests as "pendingRequests",
           events_7d as "events7d", events_30d as "events30d", by_event as "byEvent",
           db_size_bytes as "dbSizeBytes", db_version as "dbVersion"
    from public.admin_overview()`;
  return { ...row!, dbSizeBytes: Number(row!.dbSizeBytes) };
}

/** Tous les clubs, avec compteurs d'activité (aucune donnée de membre). */
export async function platformClubs(tx: Tx): Promise<PlatformClub[]> {
  return tx<PlatformClub[]>`
    select id, name, timezone, created_at as "createdAt", owner_email as "ownerEmail", members, staff,
           sessions_30d as "sessions30d", events_7d as "events7d", events_30d as "events30d", last_event_at as "lastEventAt", disabled_features as "disabledFeatures"
    from public.admin_list_clubs()`;
}

/** État des tâches planifiées (une ligne par tâche déjà exécutée au moins une fois). */
export async function platformJobs(tx: Tx): Promise<JobRun[]> {
  const rows = await tx<(Omit<JobRun, "successes" | "failures"> & { successes: string; failures: string })[]>`
    select job, last_run_at as "lastRunAt", last_success_at as "lastSuccessAt", last_failure_at as "lastFailureAt",
           last_error as "lastError", successes, failures
    from public.admin_job_runs()`;
  return rows.map((r) => ({ ...r, successes: Number(r.successes), failures: Number(r.failures) }));
}

/** Envois des 7 et 30 derniers jours, par type. */
export async function platformCounters(tx: Tx): Promise<Record<Metric, { n7: number; n30: number }>> {
  const rows = await tx<{ metric: Metric; n7: string; n30: string }[]>`select metric, n7, n30 from public.admin_counters()`;
  return Object.fromEntries(rows.map((r) => [r.metric, { n7: Number(r.n7), n30: Number(r.n30) }])) as Record<Metric, { n7: number; n30: number }>;
}
