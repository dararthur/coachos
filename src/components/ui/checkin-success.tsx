"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { assiduityLabel } from "@/domain/assiduity";
import { ordinal } from "@/domain/ranking";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { checkinProgressAction, type CheckinProgressDto } from "@/server/actions/progress";
import { Tally } from "./assiduity";
import { buttonClasses } from "./button-classes";

/**
 * Pointage confirmé par le serveur. Le moment fort de l'adhérent : la bande de la semaine se pose sur sa barrette, avec
 * ses venues du mois et son rang. La progression est lue APRÈS la confirmation (lecture seule) ; si elle échoue, l'écran
 * reste un succès simple : rien n'est supposé ni inventé.
 */
export function CheckinSuccess({ kind, className, startsAt, status }: { kind: "recorded" | "already"; className: string; startsAt: string; status: AttendanceStatus | null }) {
  const [progress, setProgress] = useState<CheckinProgressDto | null>(null);

  useEffect(() => {
    let live = true;
    checkinProgressAction(startsAt)
      .then((r) => {
        if (live && r.ok && r.data) setProgress(r.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [startsAt]);

  const recorded = kind === "recorded";
  return (
    <div role="status" className="space-y-5" data-testid="checkin-success">
      <div>
        <h2 className="text-title font-bold font-stretch-[80%]">{recorded ? "Présence enregistrée" : "Déjà pointé"}</h2>
        <p className="mt-1 text-ink-soft">
          {recorded ? <>Pour « {className} ».</> : <>Votre présence est déjà enregistrée pour « {className} »{status ? ` (${ATTENDANCE_LABELS[status].toLowerCase()})` : ""}.</>}
        </p>
      </div>

      {progress && (
        <div className="space-y-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Tally weeks={progress.weeks} size="lg" taped={recorded && progress.newStripe} />
            <p className="text-sm">
              <span className="block font-semibold">{recorded && progress.newStripe ? "Une bande de plus cette semaine" : "Assiduité"}</span>
              <span className="text-ink-soft">{assiduityLabel(progress.weeks)}</span>
            </p>
          </div>
          <p className="text-sm">
            <strong className="text-lg font-bold tabular-nums">{progress.monthVisits}</strong>{" "}
            {progress.monthVisits > 1 ? "venues" : "venue"} ce mois-ci
            {progress.rank !== null && (
              <>
                {" · "}
                <strong className="font-semibold">{ordinal(progress.rank)}</strong> du club{progress.tied ? " (ex æquo)" : ""}
              </>
            )}
          </p>
          {progress.rank !== null && (
            <p className="text-sm text-ink-soft">
              <Link href={`/a/${progress.academyId}/ranking`}>Voir le classement</Link>
              {progress.visible ? "" : " · votre rang n'est visible que de vous"}
            </p>
          )}
        </div>
      )}

      <Link href="/" className={buttonClasses({ variant: "secondary" })}>
        Terminer
      </Link>
    </div>
  );
}
