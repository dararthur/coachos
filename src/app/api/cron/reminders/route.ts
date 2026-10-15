import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { logger } from "@/server/logger";
import { sendSessionReminders } from "@/server/session-reminders";

/** Rappels de séance (push), appelée toutes les 5 minutes par la tâche planifiée avec `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return new NextResponse(null, { status: 404 });
  try {
    const result = await sendSessionReminders();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("cron.reminders_failed", error);
    return NextResponse.json({ error: "reminders_failed" }, { status: 500 });
  }
}

export const GET = POST;
