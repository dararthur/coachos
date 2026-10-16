/**
 * Surveillance de la sauvegarde nocturne (03 h 30, jusqu'à 10 min de décalage aléatoire). Elle signale « faite » à l'application après chaque
 * réussite. À la purge de 03 h 10, la dernière sauvegarde date normalement d'un peu moins de 24 h : au-delà de 30 h, une nuit a été manquée.
 */
export const BACKUP_MAX_AGE_HOURS = 30;

export type BackupWatch = { state: "unknown" } | { state: "fresh"; hours: number } | { state: "stale"; hours: number };

/**
 * `lastSuccessAt` null = le signal n'a jamais été reçu (installation pas encore faite) : on ne prévient pas chaque nuit pour une chose
 * qui n'a jamais été branchée, la console l'affiche en « Jamais exécutée ».
 */
export function backupWatch(lastSuccessAt: Date | null, now: Date): BackupWatch {
  if (!lastSuccessAt) return { state: "unknown" };
  const hours = Math.floor((now.getTime() - lastSuccessAt.getTime()) / 3_600_000);
  return hours >= BACKUP_MAX_AGE_HOURS ? { state: "stale", hours } : { state: "fresh", hours };
}
