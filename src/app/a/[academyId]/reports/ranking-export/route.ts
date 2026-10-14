import { NextResponse, type NextRequest } from "next/server";
import { safeFilename, toCsv } from "@/domain/csv-export";
import { defaultReportRange, parseWith, reportFilterSchema } from "@/domain/validation";
import { AppError } from "@/domain/errors";
import { localDate } from "@/domain/dates";
import { competitionRanks } from "@/domain/ranking";
import { authorizeAcademy, inAcademy } from "@/server/auth/guards";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { recordEvent } from "@/server/repositories/members";
import { attendanceCountsForExport } from "@/server/repositories/reports";

const noStore = { "Cache-Control": "no-store" };

/** Export CSV du classement d'assiduité : nombre de présences de chaque membre sur la période choisie (administrateurs). Journalisé (compteur seulement). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  try {
    const ctx = await authorizeAcademy(academyId, "reports.export");
    await enforceRateLimit("export", ctx.user.id, LIMITS.exportCsv.max, LIMITS.exportCsv.window);
    const tz = ctx.academy.timezone;
    const q = request.nextUrl.searchParams;
    const defaults = defaultReportRange(localDate(new Date(), tz));
    const parsed = parseWith(reportFilterSchema, {
      from: q.get("from") || defaults.from,
      to: q.get("to") || defaults.to,
      classTypeId: q.get("classTypeId") ?? "",
      personId: "",
    });
    if (!parsed.ok) throw new AppError("validation", { fieldErrors: parsed.fieldErrors });

    const rows = await inAcademy(ctx, async (tx) => {
      const list = await attendanceCountsForExport(tx, academyId, tz, { from: parsed.data.from, to: parsed.data.to, classTypeId: parsed.data.classTypeId });
      await recordEvent(tx, academyId, "attendance.exported", { rows: list.length });
      return list;
    });
    const ranks = competitionRanks(rows.map((r) => r.present));
    const csv = toCsv(
      ["Rang", "Prénom", "Nom", "Présences", "dont retards", "Absences", "Du", "Au"],
      rows.map((r, i) => [ranks[i], r.firstName, r.lastName, r.present, r.late, r.absent, parsed.data.from, parsed.data.to]),
    );
    const name = safeFilename(`classement-${parsed.data.from}-${parsed.data.to}`, "csv");
    return new NextResponse(csv, {
      headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof AppError) {
      const status = { not_authenticated: 401, forbidden: 403, not_found: 404, rate_limited: 429, validation: 400 }[error.code as string] ?? 400;
      return new NextResponse(error.message, { status, headers: noStore });
    }
    logger.error("attendance.ranking_export", error);
    return new NextResponse("Erreur interne", { status: 500, headers: noStore });
  }
}
