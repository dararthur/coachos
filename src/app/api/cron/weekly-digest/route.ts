import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { logger } from "@/server/logger";
import { sendWeeklyDigest } from "@/server/weekly-digest";

/**
 * Récapitulatif hebdomadaire des chiffres clés, appelé le dimanche à 20 h (Paris) par la tâche planifiée avec `Authorization: Bearer $CRON_SECRET`.
 * `?force=1` ignore la protection contre le double envoi (essai manuel). La réponse ne contient ni destinataire ni chiffre.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return new NextResponse(null, { status: 404 });
  try {
    const result = await sendWeeklyDigest({ force: request.nextUrl.searchParams.get("force") === "1" });
    return NextResponse.json(result.sent ? { sent: true } : { sent: false, reason: result.reason }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("cron.weekly_digest_failed", error);
    return NextResponse.json({ error: "weekly_digest_failed" }, { status: 500 });
  }
}

export const GET = POST;
