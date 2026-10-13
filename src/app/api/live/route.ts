import { NextResponse } from "next/server";

/**
 * Vivacité du PROCESSUS uniquement : répond tant que le serveur Node tourne. Aucun accès base de données, aucune configuration
 * lue. NE DOIT PAS servir à déclarer le service « sain » : c'est le rôle de /api/health (disponibilité réelle des dépendances).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "alive" }, { headers: { "Cache-Control": "no-store" } });
}
