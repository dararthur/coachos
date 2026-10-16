import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { recordJob } from "@/server/monitoring";

/** Tâches qui signalent elles-mêmes leur réussite (lancées par systemd hors application). Liste fermée. */
const SIGNALLING_JOBS = ["backup"] as const;

/**
 * « Dead man's switch » : après une sauvegarde réussie, systemd appelle `/api/cron/heartbeat?job=backup` avec `Authorization: Bearer $CRON_SECRET`.
 * L'application enregistre l'instant ; la purge nocturne prévient l'administrateur si le signal manque depuis plus de 30 h.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return new NextResponse(null, { status: 404 });
  const job = request.nextUrl.searchParams.get("job");
  if (!(SIGNALLING_JOBS as readonly string[]).includes(job ?? "")) return NextResponse.json({ error: "unknown_job" }, { status: 400 });
  await recordJob(job as (typeof SIGNALLING_JOBS)[number], true);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = POST;
