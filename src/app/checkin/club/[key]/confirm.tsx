"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { redeemClubCheckinAction } from "@/server/actions/checkin";
import { formatDateTime, formatTime, localDate } from "@/domain/dates";
import { ATTENDANCE_LABELS } from "@/domain/validation";
import { CheckinSuccess } from "@/components/ui/checkin-success";
import { buttonClasses } from "@/components/ui/button-classes";
import type { FixedCandidate, FixedPeek } from "@/server/repositories/checkin";

/** « Prochain cours : « JJB — Tous niveaux », à 19:00. Le pointage ouvre à 18:15. » : l'adhérent arrivé tôt sait quand revenir. */
function NextSession({ next, timezone, beforeMinutes }: { next: NonNullable<FixedPeek["next"]>; timezone: string; beforeMinutes: number }) {
  const opens = new Date(new Date(next.startsAt).getTime() - beforeMinutes * 60_000);
  const sameDay = localDate(new Date(next.startsAt), timezone) === localDate(new Date(), timezone);
  const when = sameDay ? formatTime(next.startsAt, timezone) : formatDateTime(next.startsAt, timezone);
  return (
    <>
      Prochain cours : « {next.className} », {sameDay ? "à " : ""}
      {when}. Le pointage ouvre {sameDay ? "à " : "le "}
      <strong className="font-semibold">{sameDay ? formatTime(opens, timezone) : formatDateTime(opens, timezone)}</strong>.
    </>
  );
}

type Outcome =
  | { kind: "recorded" | "already"; className: string; startsAt: string; status: keyof typeof ATTENDANCE_LABELS | null }
  | { kind: "waitlisted"; className: string }
  | { kind: "error"; text: string }
  | null;

/**
 * Le choix du cours respecte les réservations : un seul cours réservé est présélectionné, sinon le membre choisit.
 * Le succès n'est affiché qu'après la réponse du serveur (même règle que le QR tournant).
 */
export function ConfirmClubCheckin({
  header,
  clubKey,
  timezone,
  sessions,
  next,
  beforeMinutes,
}: {
  /** Titre, affiché tant que la présence n'est pas confirmée (le succès a son propre titre). */
  header: ReactNode;
  clubKey: string;
  timezone: string;
  sessions: FixedCandidate[];
  next: FixedPeek["next"];
  beforeMinutes: number;
}) {
  const booked = sessions.filter((s) => s.booking === "booked");
  const [selected, setSelected] = useState<string | null>(sessions.length === 1 ? sessions[0]!.sessionId : booked.length === 1 ? booked[0]!.sessionId : null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, start] = useTransition();

  if (sessions.length === 0) {
    return (
      <>
        {header}
        <div className="space-y-3">
          <div className="rounded-sm border border-line bg-sunken px-3 py-3 text-sm" data-testid="checkin-none">
            <p className="font-semibold">Aucun cours à pointer en ce moment.</p>
            <p className="mt-1">{next ? <NextSession next={next} timezone={timezone} beforeMinutes={beforeMinutes} /> : "Aucun cours n'est prévu prochainement au planning du club."}</p>
          </div>
          <Link href="/" className={buttonClasses({ variant: "secondary" })}>
            Terminer
          </Link>
        </div>
      </>
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
        else setOutcome({ kind: r.data.result, className: r.data.className, startsAt: r.data.startsAt, status: r.data.status });
      } catch {
        setOutcome({ kind: "error", text: "Connexion perdue : votre présence n'est peut-être pas enregistrée. Réessayez : vous ne serez pas pointé deux fois." });
      }
    });
  }

  if (outcome && outcome.kind !== "error") {
    if (outcome.kind !== "waitlisted") return <CheckinSuccess kind={outcome.kind} className={outcome.className} startsAt={outcome.startsAt} status={outcome.status} />;
    return (
      <>
        {header}
        <div role="status" className="space-y-3">
          <p className="rounded-sm border border-warning/35 bg-warning-soft px-3 py-3 text-sm text-warning-ink" data-testid="checkin-waitlisted">
            La séance est complète : vous êtes sur liste d&apos;attente pour « {outcome.className} ». Votre présence n&apos;est pas enregistrée ; le coach peut vous accorder une place.
          </p>
          <Link href="/" className={buttonClasses({ variant: "secondary" })}>
            Terminer
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">{sessions.length > 1 ? "Quel cours ?" : "Cours"}</legend>
          {sessions.map((s) => {
            const on = s.sessionId === selected;
            return (
              <label
                key={s.sessionId}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 ${on ? "border-ink bg-sunken" : "border-line-strong bg-surface"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent`}
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
        {!current && (
          <p id="choose-session" className="text-sm font-semibold">
            Choisissez votre cours ci-dessus pour confirmer.
          </p>
        )}
        <button type="button" className={buttonClasses({ className: "w-full" })} disabled={pending || !current} aria-describedby={current ? undefined : "choose-session"} onClick={confirm}>
          {pending ? "Enregistrement…" : outcome?.kind === "error" ? "Réessayer" : current && current.booking === null && !current.status ? "Réserver et confirmer ma présence" : "Confirmer ma présence"}
        </button>
        <p className="text-xs text-ink-soft">Seule votre propre présence est enregistrée, au nom du compte connecté.</p>
      </div>
    </>
  );
}
