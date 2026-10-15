import "server-only";
import { after } from "next/server";
import webpush from "web-push";
import type { PushPayload } from "@/domain/push";
import { withApp, type Sql } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * Notifications push (Web Push, chiffrées de bout en bout ; le service du navigateur ne voit passer qu'un message opaque).
 * Désactivées tant que les clés VAPID ne sont pas configurées. Envoi « au mieux » : une notification perdue n'est pas rejouée
 * (l'information reste dans l'application) ; un appareil que son service déclare disparu (404/410) est supprimé.
 */

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSender = (target: PushTarget, body: string) => Promise<void>;

const BATCH = 20;

export function vapidPublicKey(): string | null {
  const e = env();
  return e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.VAPID_SUBJECT ? e.VAPID_PUBLIC_KEY : null;
}

const defaultSender: PushSender = async (target, body) => {
  const e = env();
  await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, body, {
    vapidDetails: { subject: e.VAPID_SUBJECT!, publicKey: e.VAPID_PUBLIC_KEY!, privateKey: e.VAPID_PRIVATE_KEY! },
    TTL: 60 * 60 * 24,
    timeout: 10_000,
  });
};

/** Envoie à chaque appareil. `gone` : appareils à supprimer. Jamais d'adresse d'appareil dans les journaux. */
export async function deliverPush(targets: PushTarget[], payload: PushPayload, send: PushSender = defaultSender): Promise<{ sent: number; failed: number; gone: string[] }> {
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    await Promise.all(
      targets.slice(i, i + BATCH).map(async (t) => {
        try {
          await send(t, body);
          sent++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(t.id);
          else {
            failed++;
            logger.error("push.send_failed", { status: status ?? null });
          }
        }
      }),
    );
  }
  return { sent, failed, gone };
}

export interface NewsPushInput {
  academyId: string;
  academyName: string;
  title: string;
  authorId: string;
}

/** Prévient les membres du club (hors l'auteur) d'une nouvelle publication. */
export async function notifyNews(input: NewsPushInput, deps: { sql?: Sql; send?: PushSender } = {}): Promise<{ sent: number; failed: number }> {
  if (!deps.send && !vapidPublicKey()) return { sent: 0, failed: 0 };
  const targets = await withApp(
    (tx) => tx<PushTarget[]>`select id, endpoint, p256dh, auth from app_private.push_targets_for_club(${input.academyId}, ${input.authorId})`,
    deps.sql,
  );
  if (targets.length === 0) return { sent: 0, failed: 0 };
  const title = input.title.length > 90 ? `${input.title.slice(0, 89)}…` : input.title;
  const result = await deliverPush(targets, { title: input.academyName, body: title, url: `/a/${input.academyId}/news` }, deps.send);
  if (result.gone.length > 0) await withApp((tx) => tx`select app_private.drop_push_subscriptions(${tx.array(result.gone)}::uuid[])`, deps.sql);
  logger.info("push.news", { sent: result.sent, failed: result.failed, gone: result.gone.length });
  return { sent: result.sent, failed: result.failed };
}

/** Après la réponse : la publication n'attend jamais l'envoi, et une erreur d'envoi ne la fait jamais échouer. */
export function notifyNewsAfterResponse(input: NewsPushInput): void {
  if (!vapidPublicKey()) return;
  after(async () => {
    try {
      await notifyNews(input);
    } catch (error) {
      logger.error("push.news_failed", error);
    }
  });
}
