import { NextResponse } from "next/server";

/** Sonde de vivacité : volontairement sans accès base de données ni détail de configuration. */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
