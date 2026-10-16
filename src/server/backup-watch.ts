import "server-only";
import { backupWatch } from "@/domain/backup-watch";
import { withApp, type Sql } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { adminAlertEmail } from "@/server/mail/templates";
import type { Mailer } from "@/server/mail/types";

export interface BackupWatchDeps {
  sql?: Sql;
  mailer?: Mailer;
  now?: Date;
  to?: string | null;
  siteUrl?: string;
}

/**
 * Appelée par la purge nocturne : si la sauvegarde n'a pas signalé sa réussite depuis plus de 30 h, prévient l'administrateur de la plateforme
 * par e-mail (chaque nuit tant que le problème dure). Ne fait jamais échouer la purge : une erreur est journalisée et renvoyée en `false`.
 */
export async function alertIfBackupStale(deps: BackupWatchDeps = {}): Promise<boolean> {
  try {
    const now = deps.now ?? new Date();
    const to = deps.to === undefined ? (env().PLATFORM_ADMIN_EMAIL ?? null) : deps.to;
    const [row] = await withApp((tx) => tx<{ at: Date | null }[]>`select app_private.job_last_success('backup') as at`, deps.sql);
    const watch = backupWatch(row?.at ?? null, now);
    if (watch.state !== "stale" || !to) return false;
    await (deps.mailer ?? getMailer()).send(
      adminAlertEmail(
        to,
        "La sauvegarde n'a pas été faite",
        `La dernière sauvegarde chiffrée de la base date de plus de ${watch.hours} heures : une nuit au moins a été manquée. Vérifiez le minuteur (systemctl list-timers coachos-backup.timer) et le journal (journalctl -u coachos-backup.service). Ce message se répète chaque nuit tant que le problème dure.`,
        `${deps.siteUrl ?? env().SITE_URL}/admin`,
      ),
    );
    return true;
  } catch {
    logger.warn("backup_watch.failed");
    return false;
  }
}
