import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeFilename } from "@/domain/csv-export";
import { AppError } from "@/domain/errors";
import { authorizeAcademy, inAcademy } from "@/server/auth/guards";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { exportPersonData } from "@/server/repositories/members";

const noStore = { "Cache-Control": "no-store" };

/** Export JSON des données d'un membre (droit d'accès / portabilité) — administrateurs, journalisé. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ academyId: string; personId: string }> }) {
  const { academyId, personId } = await params;
  try {
    const ctx = await authorizeAcademy(academyId, "members.erase");
    await enforceRateLimit("personal-export", ctx.user.id, LIMITS.personalExport.max, LIMITS.personalExport.window);
    if (!z.uuid().safeParse(personId).success) throw new AppError("not_found");
    const data = await inAcademy(ctx, (tx) => exportPersonData(tx, personId));
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        ...noStore,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename("coachos-donnees-membre", "json")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      const status = { not_authenticated: 401, forbidden: 403, not_found: 404, rate_limited: 429 }[error.code as string] ?? 400;
      return new NextResponse(error.message, { status, headers: noStore });
    }
    logger.error("member.export", error);
    return new NextResponse("Erreur interne", { status: 500, headers: noStore });
  }
}
