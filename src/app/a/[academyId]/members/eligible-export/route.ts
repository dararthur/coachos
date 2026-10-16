import { NextResponse, type NextRequest } from "next/server";
import { safeFilename, toCsv } from "@/domain/csv-export";
import { localDate } from "@/domain/dates";
import { AppError } from "@/domain/errors";
import { GROUP_LABELS } from "@/domain/graduation";
import { BELT_LABELS } from "@/domain/profile";
import { authorizeAcademy, inAcademy } from "@/server/auth/guards";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { listPromotionCandidates } from "@/server/repositories/graduation";
import { recordEvent } from "@/server/repositories/members";

const noStore = { "Cache-Control": "no-store" };

/**
 * Export CSV « Éligibles au grade suivant » : les adhérents actifs qui atteignent (ou atteindront sous 30 jours) les minimums IBJJF de durée et d'âge.
 * Réservé à l'équipe qui voit la liste (module « Grades et rapports »). Indicatif : la décision du passage reste celle du professeur.
 * La date d'éligibilité est calculée à l'instant de l'export, jamais stockée. Journalisé (compteur seulement).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  try {
    const ctx = await authorizeAcademy(academyId, "members.grade", "reports");
    await enforceRateLimit("export", ctx.user.id, LIMITS.exportCsv.max, LIMITS.exportCsv.window);
    const today = localDate(new Date(), ctx.academy.timezone);
    const { items } = await inAcademy(ctx, async (tx) => {
      const list = await listPromotionCandidates(tx, academyId, today, Number.MAX_SAFE_INTEGER);
      await recordEvent(tx, academyId, "promotions.exported", { rows: list.total });
      return list;
    });
    const csv = toCsv(
      ["Prénom", "Nom", "Ceinture actuelle", "Barrettes", "Ceinture suivante", "Statut", "Éligible depuis / à partir du", "Dans cette ceinture depuis", "Date de départ confirmée", "Passage attendu"],
      items.map((c) => [
        c.firstName,
        c.lastName,
        BELT_LABELS[c.belt],
        c.stripes,
        c.eligibility.next ? GROUP_LABELS[c.eligibility.next] : "",
        c.eligibility.status === "eligible" ? "Éligible" : "Bientôt éligible",
        c.eligibility.eligibleOn ?? "",
        c.eligibility.since ?? "",
        c.eligibility.sinceConfirmed ? "Oui" : "Non",
        c.eligibility.due ? "Oui" : "Non",
      ]),
    );
    const name = safeFilename(`eligibles-grade-suivant-${today}`, "csv");
    return new NextResponse(csv, {
      headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof AppError) {
      const status = { not_authenticated: 401, forbidden: 403, feature_disabled: 403, not_found: 404, rate_limited: 429, validation: 400 }[error.code as string] ?? 400;
      return new NextResponse(error.message, { status, headers: noStore });
    }
    logger.error("promotions.export", error);
    return new NextResponse("Erreur interne", { status: 500, headers: noStore });
  }
}
