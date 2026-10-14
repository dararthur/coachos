import { NextResponse } from "next/server";
import { safeFilename, toCsv } from "@/domain/csv-export";
import { AppError } from "@/domain/errors";
import { localDate } from "@/domain/dates";
import { authorizeAcademy, inAcademy } from "@/server/auth/guards";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { listAllForExport, recordEvent } from "@/server/repositories/members";

const noStore = { "Cache-Control": "no-store" };

/** Export CSV de l'annuaire des membres (administrateurs). Cellules neutralisées contre l'injection de formules. */
export async function GET(_request: Request, { params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  try {
    const ctx = await authorizeAcademy(academyId, "reports.export");
    await enforceRateLimit("export", ctx.user.id, LIMITS.exportCsv.max, LIMITS.exportCsv.window);
    const rows = await inAcademy(ctx, async (tx) => {
      const list = await listAllForExport(tx, academyId);
      await recordEvent(tx, academyId, "members.exported", { rows: list.length });
      return list;
    });
    const csv = toCsv(
      ["Prénom", "Nom", "E-mail", "Téléphone", "Date d'inscription", "Identifiant d'origine", "Statut"],
      rows.map((p) => [p.firstName, p.lastName, p.email, p.phone, p.joinedOn, p.externalRef, p.archivedAt ? "archivé" : "actif"]),
    );
    const name = safeFilename(`membres-${ctx.academy.name}-${localDate(new Date(), ctx.academy.timezone)}`, "csv");
    return new NextResponse(csv, {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      const status = { not_authenticated: 401, forbidden: 403, not_found: 404, rate_limited: 429 }[error.code as string] ?? 400;
      return new NextResponse(error.message, { status, headers: noStore });
    }
    logger.error("members.export", error);
    return new NextResponse("Erreur interne", { status: 500, headers: noStore });
  }
}
