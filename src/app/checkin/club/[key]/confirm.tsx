"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { redeemClubCheckinAction } from "@/server/actions/checkin";
import { formatDateTime } from "@/domain/dates";
import { ATTENDANCE_LABELS } from "@/domain/validation";
import { buttonClasses } from "@/components/ui/button-classes";
import type { FixedCandidate } from "@/server/repositories/checkin";

type Outcome =
  | { kind: "recorded" | "already"; className: string; status: keyof typeof ATTENDANCE_LABELS | null }
  | { kind: "waitlisted"; className: string }
  | { kind: "error"; text: string }
  | null;

/**
 * Le choix du cours respecte les réservations : un seul cours réservé est présélectionné, sinon le membre choisit.
 * Le succès n'est affiché qu'après la réponse du serveur (même règle que le QR tournant).
 */
export function ConfirmClubCheckin({ clubKey, timezone, sessions }: { clubKey: string; timezone: string; sessions: FixedCandidate[] }) {
  const booked = sessions.filter((s) => s.booking === "booked");
  const [selected, setSelected] = useState<string | null>(sessions.length === 1 ? sessions[0]!.sessionId : booked.length === 1 ? booked[0]!.sessionId : null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, start] = useTransition();

  if (sessions.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-sm border border-line bg-sunken px-3 py-3 text-sm">
          Aucun cours à pointer en ce moment. Le pointage s&apos;ouvre un peu avant le début du cours et reste possible un court moment après.
        </p>
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          Terminer
        </Link>
      </div>
    );
  }

  const current = sessions.find((s) => s.sessionId === selected) ?? null;

  function confirm() {
    if (!current) return;
    start(async () => {
      try {
        const r = await redeemClubCheckinAction(clubKey, current.sessionId, current.booking === null && !current.status);
        if (!r.ok) setOutcome({ kind: "error", text: r.error });
        else if (r.data.result === "waitlisted" || r.data.status === null) setOutcome({ kind: "waitlisted", className: r.data.className });
        else setOutcome({ kind: r.data.result, className: r.data.className, status: r.data.status });
      } catch {
        setOutcome({ kind: "error", text: "Connexion perdue : votre présence n'est peut-être pas enregistrée. Réessayez : vous ne serez pas pointé deux fois." });
      }
    });
  }

  if (outcome && outcome.kind !== "error") {
    return (
      <div role="status" className="space-y-3">
        {outcome.kind === "waitlisted" ? (
          <p className="rounded-sm border border-warning/35 bg-warning-soft px-3 py-3 text-sm text-warning-ink" data-testid="checkin-waitlisted">
            La séance est complète : vous êtes sur liste d&apos;attente pour « {outcome.className} ». Votre présence n&apos;est pas enregistrée ; le coach peut vous accorder une place.
          </p>
        ) : (
          <p className="rounded-sm border border-success/30 bg-success-soft px-3 py-3 text-sm text-success-ink" data-testid="checkin-success">
            {outcome.kind === "recorded"
              ? `Présence enregistrée pour « ${outcome.className} ».`
              : `Votre présence est déjà enregistrée pour « ${outcome.className} »${outcome.status ? ` (${ATTENDANCE_LABELS[outcome.status].toLowerCase()})` : ""}.`}
          </p>
        )}
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          Terminer
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">{sessions.length > 1 ? "Quel cours ?" : "Cours"}</legend>
        {sessions.map((s) => {
          const on = s.sessionId === selected;
          return (
            <label
              key={s.sessionId}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 ${on ? "border-ink bg-sunken" : "border-line-strong bg-surface"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink`}
            >
              <input type="radio" name="session" className="size-5 accent-[var(--color-accent)]" checked={on} onChange={() => setSelected(s.sessionId)} />
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{s.className}</span>
                <span className="block text-sm text-ink-soft">{formatDateTime(s.startsAt, timezone)}</span>
              </span>
              {s.booking === "booked" && <span className="rounded-xs bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-ink">Inscrit</span>}
              {s.booking === "waitlisted" && <span className="rounded-xs bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-ink">Liste d&apos;attente</span>}
            </label>
          );
        })}
      </fieldset>
      {outcome?.kind === "error" && (
        <p role="alert" className="rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {outcome.text}
        </p>
      )}
      {current && current.booking === null && !current.status && (
        <p className="rounded-sm border border-line bg-sunken px-3 py-2 text-sm">Vous n&apos;avez pas encore réservé ce cours. Un seul geste réserve votre place et enregistre votre présence.</p>
      )}
      <button type="button" className={buttonClasses({ className: "w-full" })} disabled={pending || !current} onClick={confirm}>
        {pending ? "Enregistrement…" : outcome?.kind === "error" ? "Réessayer" : current && current.booking === null && !current.status ? "Réserver et confirmer ma présence" : "Confirmer ma présence"}
      </button>
      <p className="text-xs text-ink-soft">Seule votre propre présence est enregistrée, au nom du compte connecté.</p>
    </div>
  );
}
