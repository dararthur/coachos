import { NextResponse } from "next/server";
import { readiness } from "@/server/health";

/**
 * Disponibilité : 200 seulement si la configuration est valide ET que les deux bases (applicative et authentification) répondent avec
 * les droits attendus ; sinon 503. Le corps ne contient jamais la cause (elle est journalisée, noms de contrôles seulement).
 * La vivacité du processus seule est /api/live.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await readiness();
  const headers = { "Cache-Control": "no-store" };
  if (r.ok) return NextResponse.json({ status: "ok" }, { headers });
  console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", event: "health.unavailable", failed: r.failed }));
  return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
}
