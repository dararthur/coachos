/** Supervision applicative : tâches planifiées appelées par systemd et compteurs d'envois (voir migration 001200). */

export const JOBS = {
  reminders: { label: "Rappels de séance", every: "toutes les 5 min", lateAfterMinutes: 15 },
  close_rolls: { label: "Clôture des feuilles d'appel", every: "toutes les heures", lateAfterMinutes: 150 },
  purge: { label: "Purge de rétention et avis de place", every: "chaque nuit", lateAfterMinutes: 30 * 60 },
  weekly_digest: { label: "Récapitulatif hebdomadaire", every: "chaque dimanche à 20 h", lateAfterMinutes: 8 * 24 * 60 },
} as const;

export type JobId = keyof typeof JOBS;
export const JOB_IDS = Object.keys(JOBS) as JobId[];

export function isJobId(value: unknown): value is JobId {
  return typeof value === "string" && Object.hasOwn(JOBS, value);
}

export const METRIC_LABELS = {
  mail_sent: "E-mails envoyés",
  mail_failed: "E-mails en échec",
  push_sent: "Notifications envoyées",
  push_failed: "Notifications en échec",
  push_gone: "Appareils expirés (supprimés)",
} as const;

export type Metric = keyof typeof METRIC_LABELS;

export interface JobRun {
  job: string;
  lastRunAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  successes: number;
  failures: number;
}

export type JobState = "ok" | "late" | "failing" | "never";

/**
 * Santé d'une tâche : jamais exécutée ; dernier passage en échec ; pas de passage depuis trop longtemps (la planification est peut-être
 * arrêtée) ; sinon bonne. « En échec » prime sur « en retard » : c'est le signal le plus précis.
 */
export function jobHealth(job: JobId, run: JobRun | null, now: Date): { state: JobState; minutesSinceRun: number | null } {
  if (!run) return { state: "never", minutesSinceRun: null };
  const minutes = Math.floor((now.getTime() - run.lastRunAt.getTime()) / 60_000);
  if (run.lastFailureAt && (!run.lastSuccessAt || run.lastFailureAt > run.lastSuccessAt)) return { state: "failing", minutesSinceRun: minutes };
  if (minutes > JOBS[job].lateAfterMinutes) return { state: "late", minutesSinceRun: minutes };
  return { state: "ok", minutesSinceRun: minutes };
}

/** « il y a 3 min », « il y a 2 h », « il y a 4 j ». */
export function sinceLabel(minutes: number): string {
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 48 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
  return `il y a ${Math.floor(minutes / (24 * 60))} j`;
}
