import "server-only";
import { after } from "next/server";
import { withApp, type Sql } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { bookingPromotedEmail } from "@/server/mail/templates";
import type { Mailer } from "@/server/mail/types";
import { claimPromotions, completePromotion } from "@/server/repositories/booking-notifications";

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
      const link = new URL(`/a/${p.academyId}/me`, siteUrl).toString();
      try {
        await mailer.send(bookingPromotedEmail(p.email, { academyName: p.academyName, className: p.className, startsAt: p.startsAt, timeZone: p.timezone, link }));
      } catch (error) {
        failed++;
        logger.error("mail.booking_promoted_failed", error); // jamais le destinataire : MailDeliveryError ne porte que le statut
        continue;
      }
      sent++;
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
