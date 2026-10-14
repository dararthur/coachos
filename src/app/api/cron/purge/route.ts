import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deliverBookingPromotions } from "@/server/booking-notifications";
import { withApp } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { purgeClubRequests } from "@/server/repositories/club-requests";

function authorized(request: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false; // sans secret configuré, la route est désactivée
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Purge de rétention (voir docs/privacy-gdpr.md). Appelée par la tâche planifiée avec `Authorization: Bearer $CRON_SECRET`.
 * Filet de sécurité ensuite : envoie les e-mails de place confirmée restés en file (échec du fournisseur, redémarrage).
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return new NextResponse(null, { status: 404 });
  try {
    const rows = await withApp((tx) => tx<{ r: Record<string, number>; a: Record<string, number> }[]>`select app_private.purge_expired_data() as r, app_private.purge_expired_auth() as a`);
    const result = { ...(rows[0]?.r ?? {}), ...(rows[0]?.a ?? {}), club_requests: await purgeClubRequests() };
    logger.info("cron.purge", result);
    let mail: { sent: number; failed: number };
    try {
      mail = await deliverBookingPromotions();
    } catch (error) {
      logger.error("cron.booking_emails_failed", error);
      return NextResponse.json({ error: "booking_emails_failed" }, { status: 500 });
    }
    return NextResponse.json({ ...result, booking_emails_sent: mail.sent, booking_emails_failed: mail.failed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("cron.purge_failed", error);
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  }
}

// Vercel Cron appelle en GET : même contrôle d'authentification.
export const GET = POST;
