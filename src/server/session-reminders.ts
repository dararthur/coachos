import "server-only";
import { formatTime } from "@/domain/dates";
import type { PushPayload } from "@/domain/push";
import { withApp, type Sql } from "@/server/db/client";
import { logger } from "@/server/logger";
import { deliverPush, vapidPublicKey, type PushSender, type PushTarget } from "@/server/push";

/**
 * Rappel push « 🥋 séance dans 1 h, tout est prêt ? » aux adhérents inscrits. Appelé toutes les 5 minutes par la tâche planifiée
 * (/api/cron/reminders). La base choisit et marque les séances (migration 001200) ; ici on compose le message et on envoie.
 */

interface ReminderRow {
  sessionId: string;
  academyId: string;
  academyName: string;
  className: string;
  startsAt: Date;
  timezone: string;
  subId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** « dans 1 h » (la tâche passe toutes les 5 minutes : en pratique 60 à 65 min), sinon « dans N min » arrondi à 5 min. */
export function reminderDelay(startsAt: Date, now: Date): string {
  const minutes = Math.max(5, Math.round((startsAt.getTime() - now.getTime()) / 300_000) * 5);
  return minutes >= 55 ? "dans 1 h" : `dans ${minutes} min`;
}

export function reminderPayload(row: Pick<ReminderRow, "academyId" | "academyName" | "className" | "startsAt" | "timezone">, now: Date): PushPayload {
  return {
    title: `🥋 ${row.academyName} : séance ${reminderDelay(row.startsAt, now)}`,
    body: `${row.className} à ${formatTime(row.startsAt, row.timezone)}. Tout est prêt ?`,
    url: `/a/${row.academyId}/me`,
  };
}

export async function sendSessionReminders(deps: { sql?: Sql; send?: PushSender; now?: Date } = {}): Promise<{ sessions: number; sent: number; failed: number }> {
  // Sans clés VAPID : rien n'est marqué (les séances seront rappelées si la fonction est activée avant leur début).
  if (!deps.send && !vapidPublicKey()) return { sessions: 0, sent: 0, failed: 0 };
  const rows = await withApp(
    (tx) => tx<ReminderRow[]>`
      select session_id as "sessionId", academy_id as "academyId", academy_name as "academyName", class_name as "className",
             starts_at as "startsAt", timezone, sub_id as "subId", endpoint, p256dh, auth
      from app_private.claim_session_reminders()`,
    deps.sql,
  );
  const now = deps.now ?? new Date();
  const bySession = new Map<string, ReminderRow[]>();
  for (const r of rows) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  for (const group of bySession.values()) {
    const targets: PushTarget[] = group.map((r) => ({ id: r.subId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
    const result = await deliverPush(targets, reminderPayload(group[0]!, now), deps.send);
    sent += result.sent;
    failed += result.failed;
    gone.push(...result.gone);
  }
  if (gone.length > 0) await withApp((tx) => tx`select app_private.drop_push_subscriptions(${tx.array(gone)}::uuid[])`, deps.sql);
  if (bySession.size > 0) logger.info("push.reminders", { sessions: bySession.size, sent, failed, gone: gone.length });
  return { sessions: bySession.size, sent, failed };
}
