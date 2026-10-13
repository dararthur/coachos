import { NextResponse } from "next/server";
import { safeFilename } from "@/domain/csv-export";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { AppError } from "@/domain/errors";

/** Export JSON des données du compte connecté (droit d'accès / portabilité). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Non authentifié", { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    await enforceRateLimit("personal-export", user.id, LIMITS.personalExport.max, LIMITS.personalExport.window);
    const rows = await withUser(user, (tx) => tx<{ data: unknown }[]>`select public.export_my_data() as data`);
    return new NextResponse(JSON.stringify(rows[0]?.data ?? {}, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename("matnexa-mes-donnees", "json")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "rate_limited") return new NextResponse("Trop de demandes", { status: 429, headers: { "Cache-Control": "no-store" } });
    logger.error("account.export", error);
    return new NextResponse("Erreur interne", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
