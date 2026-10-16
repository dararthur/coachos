import "server-only";
import { after } from "next/server";
import { withApp, type Sql } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { bookingPromotedEmail, sessionCancelledEmail } from "@/server/mail/templates";
import type { Mailer } from "@/server/mail/types";
import type { PushPayload } from "@/domain/push";
import { claimPromotions, completePromotion, pushTargetsFor, type PendingPromotion } from "@/server/repositories/booking-notifications";
import { deliverPush, vapidPublicKey, type PushSender } from "@/server/push";

/**
 * E-mails « votre place est confirmée » aux adhérents promus depuis la liste d'attente.
 *
 * La base met chaque promotion en file dans la transaction qui la cause (migration 0022) ; ce module vide la file avec le rôle
 * `app_server`. Envoi « au moins une fois » : un échec laisse la ligne en file (nouvelle tentative 10 minutes plus tard, au plus
 * 5) ; seul un crash entre la remise au fournisseur et l'effacement de la ligne peut produire un doublon.
 */

const BATCH = 20;
const MAX_BATCHES = 5;

export interface DeliveryDeps {
  /** Injectables pour les tests ; en production : client global, fournisseur de MAIL_PROVIDER, SITE_URL. */
  sql?: Sql;
  mailer?: Mailer;
  siteUrl?: string;
  /** Envoi push simulé (tests). */
  send?: PushSender;
}

/**
 * Texte neutre : lisible sur un écran verrouillé sans rien révéler (ni nom, ni cours, ni horaire, ni autres inscrits). Le détail est dans
 * l'application, un toucher y mène.
 */
export function notificationPayload(p: Pick<PendingPromotion, "kind" | "academyId" | "academyName">): PushPayload {
  return p.kind === "cancelled"
    ? { title: `${p.academyName} : séance annulée`, body: "Une séance que vous aviez réservée est annulée.", url: `/a/${p.academyId}/schedule` }
    : { title: `${p.academyName} : place confirmée`, body: "Une place s'est libérée : votre réservation est confirmée.", url: `/a/${p.academyId}/me` };
}

/** Push « au mieux » après l'e-mail : n'influence jamais la file (un échec push ne rejoue pas l'e-mail). */
async function pushToMember(p: PendingPromotion, deps: DeliveryDeps): Promise<void> {
  try {
    if (!deps.send && !vapidPublicKey()) return; // fonction désactivée sans clés VAPID
    const targets = await withApp((tx) => pushTargetsFor(tx, p.userId, p.academyId), deps.sql);
    if (targets.length === 0) return;
    const result = await deliverPush(targets, notificationPayload(p), deps.send);
    if (result.gone.length > 0) await withApp((tx) => tx`select app_private.drop_push_subscriptions(${tx.array(result.gone)}::uuid[])`, deps.sql);
  } catch (error) {
    logger.error("push.booking_notification_failed", error);
  }
}

export async function deliverBookingPromotions(deps: DeliveryDeps = {}): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let round = 0; round < MAX_BATCHES; round++) {
    const batch = await withApp((tx) => claimPromotions(tx, BATCH), deps.sql);
    if (batch.length === 0) break;
    const mailer = deps.mailer ?? getMailer();
    const siteUrl = deps.siteUrl ?? env().SITE_URL;
    for (const p of batch) {
      const link = new URL(p.kind === "cancelled" ? `/a/${p.academyId}/schedule` : `/a/${p.academyId}/me`, siteUrl).toString();
      const content = { academyName: p.academyName, className: p.className, startsAt: p.startsAt, timeZone: p.timezone, link };
      try {
        await mailer.send(p.kind === "cancelled" ? sessionCancelledEmail(p.email, content) : bookingPromotedEmail(p.email, content));
      } catch (error) {
        failed++;
        logger.error("mail.booking_promoted_failed", error); // jamais le destinataire : MailDeliveryError ne porte que le statut
        continue;
      }
      sent++;
      await pushToMember(p, deps);
      try {
        await withApp((tx) => completePromotion(tx, p.id), deps.sql);
      } catch (error) {
        // E-mail parti mais ligne conservée : il repartira à l'expiration du bail (doublon possible, jamais de perte).
        logger.error("mail.booking_promoted_complete_failed", error);
      }
    }
    if (batch.length < BATCH) break;
  }
  if (sent > 0 || failed > 0) logger.info("mail.booking_promoted", { sent, failed });
  return { sent, failed };
}

/**
 * Server Actions qui peuvent promouvoir un adhérent (annulation, place accordée, capacité, archivage, effacement) : envoie les
 * e-mails après la réponse, sans la retarder. Une erreur est journalisée ; la ligne reste en file pour la purge quotidienne.
 */
export function deliverBookingPromotionsAfterResponse(): void {
  after(async () => {
    try {
      await deliverBookingPromotions();
    } catch (error) {
      logger.error("mail.booking_promoted_drain_failed", error);
    }
  });
}
