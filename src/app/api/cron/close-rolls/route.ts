import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { logger } from "@/server/logger";
import { closeDueRolls } from "@/server/roll-closure";

/** Clôture des feuilles d'appel de la veille, appelée toutes les heures par la tâche planifiée avec `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return new NextResponse(null, { status: 404 });
  try {
    const result = await closeDueRolls();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("cron.close_rolls_failed", error);
    return NextResponse.json({ error: "close_rolls_failed" }, { status: 500 });
  }
}

export const GET = POST;
