"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { bookAndRedeemCheckinAction, redeemCheckinAction } from "@/server/actions/checkin";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { buttonClasses } from "@/components/ui/button-classes";

type Outcome =
  | { kind: "recorded" | "already"; status: AttendanceStatus; className: string }
  | { kind: "waitlisted"; className: string }
  | { kind: "error"; text: string }
  | null;

/**
 * Le succès n'est affiché qu'après la réponse du serveur confirmant l'écriture. En cas d'erreur réseau le résultat est
 * inconnu : on le dit et on propose de réessayer (sans risque : un seul pointage par séance, même si la première
 * requête avait abouti).
 */
export function ConfirmCheckin({ token, className, alreadyStatus, booking }: { token: string; className: string; alreadyStatus: AttendanceStatus | null; booking: "booked" | "waitlisted" | null }) {
  const [outcome, setOutcome] = useState<Outcome>(alreadyStatus ? { kind: "already", status: alreadyStatus, className } : null);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      try {
        // Sans réservation (et sans présence déjà saisie), le geste réserve puis pointe.
        const needsBooking = booking === null && !alreadyStatus;
        const r = await (needsBooking ? bookAndRedeemCheckinAction(token) : redeemCheckinAction(token));
        if (r.ok) setOutcome(r.data.result === "waitlisted" || r.data.status === null ? { kind: "waitlisted", className: r.data.className } : { kind: r.data.result, status: r.data.status, className: r.data.className });
        else setOutcome({ kind: "error", text: r.error });
      } catch {
        setOutcome({ kind: "error", text: "Connexion perdue : votre présence n'est peut-être pas enregistrée. Réessayez : vous ne serez pas pointé deux fois." });
      }
    });
  }

  if (outcome?.kind === "waitlisted" || (!outcome && booking === "waitlisted" && !alreadyStatus)) {
    return (
      <div role="status" className="space-y-3">
        <p className="rounded-sm border border-warning/35 bg-warning-soft px-3 py-3 text-sm text-warning-ink" data-testid="checkin-waitlisted">
          La séance est complète : vous êtes sur liste d&apos;attente pour « {className} ». Votre présence n&apos;est pas enregistrée ; le coach peut vous accorder une place.
        </p>
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          Terminer
        </Link>
      </div>
    );
  }

  if (outcome && outcome.kind !== "error") {
    return (
      <div role="status" className="space-y-3">
        <p className="rounded-sm border border-success/30 bg-success-soft px-3 py-3 text-sm text-success-ink" data-testid="checkin-success">
          {outcome.kind === "recorded"
            ? `Présence enregistrée pour « ${outcome.className} ».`
            : `Votre présence est déjà enregistrée pour « ${outcome.className} » (${ATTENDANCE_LABELS[outcome.status].toLowerCase()}).`}
        </p>
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          Terminer
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {outcome?.kind === "error" && (
        <p role="alert" className="rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {outcome.text}
        </p>
      )}
      {booking === null && !alreadyStatus && <p className="rounded-sm border border-line bg-sunken px-3 py-2 text-sm">Vous n&apos;avez pas encore réservé ce cours. Un seul geste réserve votre place et enregistre votre présence.</p>}
      <button type="button" className={buttonClasses({ className: "w-full" })} disabled={pending} onClick={confirm}>
        {pending ? "Enregistrement…" : outcome?.kind === "error" ? "Réessayer" : booking === null && !alreadyStatus ? "Réserver et confirmer ma présence" : "Confirmer ma présence"}
      </button>
      <p className="text-xs text-ink-soft">Seule votre propre présence est enregistrée, au nom du compte connecté.</p>
    </div>
  );
}
