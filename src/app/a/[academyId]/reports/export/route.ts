import { NextResponse, type NextRequest } from "next/server";
import { safeFilename, toCsv } from "@/domain/csv-export";
import { defaultReportRange, parseWith, reportFilterSchema, ATTENDANCE_LABELS } from "@/domain/validation";
import { AppError } from "@/domain/errors";
import { localDate, localParts } from "@/domain/dates";
import { authorizeAcademy, inAcademy } from "@/server/auth/guards";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { recordEvent } from "@/server/repositories/members";
import { attendanceForExport } from "@/server/repositories/reports";

const noStore = { "Cache-Control": "no-store" };

/** Export CSV des présences (administrateurs). Les filtres sont revalidés ; l'export est journalisé (compteur seulement). */
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
      personId: q.get("personId") ?? "",
    });
    if (!parsed.ok) throw new AppError("validation", { fieldErrors: parsed.fieldErrors });

    const rows = await inAcademy(ctx, async (tx) => {
      const list = await attendanceForExport(tx, academyId, tz, parsed.data);
      await recordEvent(tx, academyId, "attendance.exported", { rows: list.length });
      return list;
    });
    const csv = toCsv(
      ["Date", "Heure", "Cours", "Discipline", "Prénom", "Nom", "Statut"],
      rows.map((r) => {
        const p = localParts(r.startsAt, tz);
        return [p.date, p.time, r.classTypeName, r.disciplineName, r.anonymized ? "" : r.firstName, r.anonymized ? "Membre anonymisé" : r.lastName, ATTENDANCE_LABELS[r.status]];
      }),
    );
    const name = safeFilename(`presences-${parsed.data.from}-${parsed.data.to}`, "csv");
    return new NextResponse(csv, {
      headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof AppError) {
      const status = { not_authenticated: 401, forbidden: 403, not_found: 404, rate_limited: 429, validation: 400 }[error.code as string] ?? 400;
      return new NextResponse(error.message, { status, headers: noStore });
    }
    logger.error("attendance.export", error);
    return new NextResponse("Erreur interne", { status: 500, headers: noStore });
  }
}
