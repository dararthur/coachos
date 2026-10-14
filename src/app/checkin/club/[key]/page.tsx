import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clubCheckinPath, isClubKey, SCAN_PATH } from "@/domain/checkin";
import { AppError, type ErrorCode } from "@/domain/errors";
import { Alert, LinkButton } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { peekFixedCheckin } from "@/server/repositories/checkin";
import { ConfirmClubCheckin } from "./confirm";

export const metadata: Metadata = { title: "Pointage", robots: { index: false }, referrer: "no-referrer" };

/**
 * Ouverture du QR fixe du club. Comme pour le QR tournant, cette page ne MODIFIE RIEN : elle liste les cours que l'heure
 * permet de pointer (réservés en premier) et demande une confirmation explicite.
 */
export default async function ClubCheckinPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(clubCheckinPath(key))}`);

  let data: Awaited<ReturnType<typeof peekFixedCheckin>> | null = null;
  let problem: ErrorCode | null = null;
  if (!isClubKey(key)) {
    problem = "checkin_invalid";
  } else {
    try {
      await enforceRateLimit("checkin-scan", user.id, LIMITS.checkinScan.max, LIMITS.checkinScan.window);
      data = await withUser(user, (tx) => peekFixedCheckin(tx, key));
    } catch (e) {
      problem = e instanceof AppError && (e.code === "checkin_no_profile" || e.code === "rate_limited") ? e.code : "checkin_invalid";
    }
  }

  return (
    <StandaloneFrame width="sm">
      <div className="rounded-sm border border-line bg-surface p-6">
        <h1 className="mb-3 text-title font-bold font-stretch-[80%]">Pointer ma présence</h1>
        {data ? (
          <ConfirmClubCheckin clubKey={key} timezone={data.timezone} sessions={data.sessions} next={data.next} beforeMinutes={data.beforeMinutes} />
        ) : (
          <>
            <Alert tone="danger" title={problem === "checkin_no_profile" ? "Compte non rattaché" : problem === "rate_limited" ? "Trop de tentatives" : "QR code invalide"}>
              {problem === "checkin_no_profile"
                ? "Votre fiche n'est pas active dans ce club : contactez le coach."
                : problem === "rate_limited"
                  ? "Patientez quelques minutes avant de réessayer."
                  : "Ce QR code n'est plus valide : il a peut-être été remplacé, ou votre club ne l'utilise plus. Demandez au coach l'affiche à jour."}
            </Alert>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={SCAN_PATH}>Scanner à nouveau</LinkButton>
              <Link href="/" className="inline-flex min-h-11 items-center px-3">
                Retour
              </Link>
            </div>
          </>
        )}
      </div>
    </StandaloneFrame>
  );
}
