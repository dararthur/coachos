import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { checkinPath, isCheckinToken } from "@/domain/checkin";
import { AppError, type ErrorCode } from "@/domain/errors";
import { formatDateTime } from "@/domain/dates";
import { Alert, LinkButton } from "@/components/ui/ui";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { hashToken } from "@/server/actions/helpers";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { peekCheckin, type CheckinPreview } from "@/server/repositories/checkin";
import { ConfirmCheckin } from "./confirm";

export const metadata: Metadata = { title: "Pointage", robots: { index: false }, referrer: "no-referrer" };

/**
 * Ouverture du lien d'un QR code. Cette page ne MODIFIE RIEN : elle affiche le cours concerné et demande une
 * confirmation explicite (un aperçu de lien ou un robot ne peut donc pas pointer à la place de quelqu'un).
 */
export default async function CheckinTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(checkinPath(token))}`);

  let preview: CheckinPreview | null = null;
  let problem: ErrorCode | null = null;
  if (!isCheckinToken(token)) {
    problem = "checkin_invalid";
  } else {
    try {
      await enforceRateLimit("checkin-scan", user.id, LIMITS.checkinScan.max, LIMITS.checkinScan.window);
      preview = await withUser(user, (tx) => peekCheckin(tx, hashToken(token)));
    } catch (e) {
      problem = e instanceof AppError && (e.code === "checkin_no_profile" || e.code === "rate_limited") ? e.code : "checkin_invalid";
    }
  }

  return (
    <main id="contenu" className="mx-auto w-full max-w-md px-4 pb-10 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold">Pointer ma présence</h1>
        {preview ? (
          <>
            <p className="mb-1 text-lg font-medium">{preview.className}</p>
            <p className="mb-4 text-sm text-muted">{formatDateTime(preview.startsAt, preview.timezone)}</p>
            <ConfirmCheckin token={token} className={preview.className} alreadyStatus={preview.alreadyRecorded ? preview.status : null} />
          </>
        ) : (
          <>
            <Alert tone="danger" title={problem === "checkin_no_profile" ? "Compte non rattaché" : problem === "rate_limited" ? "Trop de tentatives" : "QR code invalide ou expiré"}>
              {problem === "checkin_no_profile"
                ? "Votre compte n'est lié à aucune fiche membre active de ce club : demandez au coach de vous rattacher."
                : problem === "rate_limited"
                  ? "Patientez quelques minutes avant de réessayer."
                  : "Ce QR code n'est plus valide (expiré, pointage fermé ou séance terminée). Demandez au coach d'afficher le QR code actuel et scannez-le à nouveau."}
            </Alert>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/checkin">Scanner à nouveau</LinkButton>
              <Link href="/" className="inline-flex min-h-11 items-center px-3">
                Retour
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
