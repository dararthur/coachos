"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { redeemCheckinAction } from "@/server/actions/checkin";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { buttonClasses } from "@/components/ui/button-classes";

type Outcome = { kind: "recorded" | "already"; status: AttendanceStatus; className: string } | { kind: "error"; text: string } | null;

/**
 * Le succès n'est affiché qu'après la réponse du serveur confirmant l'écriture. En cas d'erreur réseau le résultat est
 * inconnu : on le dit et on propose de réessayer (sans risque : un seul pointage par séance, même si la première
 * requête avait abouti).
 */
export function ConfirmCheckin({ token, className, alreadyStatus }: { token: string; className: string; alreadyStatus: AttendanceStatus | null }) {
  const [outcome, setOutcome] = useState<Outcome>(alreadyStatus ? { kind: "already", status: alreadyStatus, className } : null);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      try {
        const r = await redeemCheckinAction(token);
        if (r.ok) setOutcome({ kind: r.data.result, status: r.data.status, className: r.data.className });
        else setOutcome({ kind: "error", text: r.error });
      } catch {
        setOutcome({ kind: "error", text: "Connexion perdue : votre présence n'est peut-être pas enregistrée. Réessayez : vous ne serez pas pointé deux fois." });
      }
    });
  }

  if (outcome && outcome.kind !== "error") {
    return (
      <div role="status" className="space-y-3">
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-950" data-testid="checkin-success">
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
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {outcome.text}
        </p>
      )}
      <button type="button" className={buttonClasses({ className: "w-full" })} disabled={pending} onClick={confirm}>
        {pending ? "Enregistrement…" : outcome?.kind === "error" ? "Réessayer" : "Confirmer ma présence"}
      </button>
      <p className="text-xs text-muted">Seule votre propre présence est enregistrée, au nom du compte connecté.</p>
    </div>
  );
}
