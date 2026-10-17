import { formatCalendarDate } from "@/domain/dates";
import { GROUP_LABELS, type Eligibility } from "@/domain/graduation";
import { BELT_LABELS, MAX_STRIPES, type Belt } from "@/domain/profile";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { BeltLabel, BeltOptions } from "@/components/ui/belt";
import { ConfirmAction } from "@/components/ui/confirm";
import { Badge } from "@/components/ui/ui";
import type { ActionResult } from "@/domain/errors";

type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown> | null>;

export type GradeRow = { id: string; belt: Belt; stripes: number; promotedOn: string; confirmed: boolean; source: "staff" | "member" };

const durationLabel = (months: number) => (months === 12 ? "1 an" : months === 18 ? "1 an et demi" : months % 12 === 0 ? `${months / 12} ans` : `${months} mois`);

/** Phrase d'état pour l'équipe : jamais montrée à l'adhérent (voir docs/graduation.md). */
export function eligibilityText(e: Eligibility): { tone: "success" | "warning" | "neutral"; text: string } | null {
  const next = e.next ? `la ceinture ${GROUP_LABELS[e.next]}` : null;
  switch (e.status) {
    case "none":
      return null;
    case "no_minimum":
      return { tone: "neutral", text: `Aucun minimum IBJJF ne s'oppose à un passage à ${next}. C'est à vous d'en décider.` };
    case "eligible":
      return { tone: "success", text: `${e.due ? "Passage à " + next + " attendu" : "Éligible à " + next} depuis le ${formatCalendarDate(e.eligibleOn!)} d'après les minimums IBJJF.` };
    case "waiting":
      return { tone: "warning", text: `Éligible à ${next} à partir du ${formatCalendarDate(e.eligibleOn!)} d'après les minimums IBJJF.` };
    case "date_unknown":
      return {
        tone: "warning",
        text: `Pour calculer l'éligibilité à ${next} (${durationLabel(e.minMonths)} minimum à la ceinture actuelle), confirmez la date à laquelle la personne l'a reçue.`,
      };
  }
}

/**
 * Historique des passages et éligibilité d'un adhérent : bloc RÉSERVÉ à l'équipe (propriétaire, administrateur, coach).
 * Les minimums sont ceux de l'IBJJF, à titre indicatif : le club décide librement de ses passages.
 */
export function GradeCard({
  history,
  eligibility,
  belt,
  today,
  recordAction,
  sinceAction,
  rowActions,
  editable,
}: {
  history: GradeRow[];
  eligibility: Eligibility;
  belt: Belt | null;
  today: string;
  recordAction: FormAction;
  sinceAction: FormAction;
  /** Correction et suppression d'une ligne de l'historique. */
  rowActions?: (gradeId: string) => { update: FormAction; remove: FormAction };
  /** Faux pour une fiche archivée : l'historique reste lisible. */
  editable: boolean;
}) {
  const state = eligibilityText(eligibility);
  const shown = [...history].reverse();
  return (
    <div className="space-y-4">
      {state && (
        <p className={`rounded-xs border px-3 py-2 text-sm ${state.tone === "success" ? "border-success/30 bg-success-soft text-success-ink" : state.tone === "warning" ? "border-warning/35 bg-warning-soft text-warning-ink" : "border-line bg-surface text-ink"}`}>
          {state.text}
        </p>
      )}
      {eligibility.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {eligibility.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-ink-soft">Aucun passage enregistré.</p>
      ) : (
        <ul aria-label="Historique des passages de ceinture" className="divide-y divide-line text-sm">
          {shown.map((r, i) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="whitespace-nowrap text-ink-soft">{formatCalendarDate(r.promotedOn)}</span>
                <BeltLabel belt={r.belt} stripes={r.stripes} size="sm" />
                <span className="flex flex-wrap gap-1.5">
                  {i === 0 && <Badge tone="success">Actuel</Badge>}
                  {!r.confirmed ? <Badge tone="warning">Date à confirmer</Badge> : r.source === "member" ? <Badge>Adhérent</Badge> : null}
                </span>
              </div>
              {editable && rowActions && <GradeRowActions row={r} today={today} actions={rowActions(r.id)} current={i === 0} previous={shown[1] ?? null} />}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <>
          <ActionForm action={recordAction} className="space-y-3 border-t border-line pt-4">
            <p className="text-sm font-semibold">Enregistrer un grade</p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Type de grade</legend>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="radio" name="kind" value="current" defaultChecked className="mt-0.5 size-5 shrink-0 accent-ink" />
                <span>
                  <span className="font-medium">Nouveau grade actuel</span>
                  <span className="block text-ink-soft">Un passage : la fiche prend ce grade.</span>
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="radio" name="kind" value="past" className="mt-0.5 size-5 shrink-0 accent-ink" />
                <span>
                  <span className="font-medium">Ancien grade</span>
                  <span className="block text-ink-soft">Pour compléter l&apos;historique : le grade actuel ne change pas.</span>
                </span>
              </label>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <SelectField label="Grade obtenu" name="belt" required defaultValue={belt ?? ""}>
                <BeltOptions />
              </SelectField>
              <SelectField label="Nombre de barrettes" name="stripes" defaultValue="0">
                {Array.from({ length: MAX_STRIPES + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </SelectField>
              <TextField label="Date d'obtention" name="on" type="date" required max={today} defaultValue={today} className="sm:col-span-2 lg:col-span-1 xl:col-span-2" />
            </div>
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer le grade</SubmitButton>
          </ActionForm>

          {belt && (
            <ActionForm action={sinceAction} className="space-y-3 border-t border-line pt-4">
              <p className="text-sm font-semibold">Date de la ceinture actuelle ({BELT_LABELS[belt].toLowerCase()})</p>
              <TextField
                label="Reçue le"
                name="on"
                type="date"
                required
                max={today}
                defaultValue={eligibility.since ?? undefined}
                hint={eligibility.sinceConfirmed ? "Date confirmée." : "Date à confirmer : sans elle, la durée minimale ne peut pas être calculée."}
              />
              <SubmitButton variant="secondary" pendingLabel="Enregistrement…">Confirmer la date</SubmitButton>
            </ActionForm>
          )}
        </>
      )}
      <p className="text-sm text-ink-soft">
        Visible de l&apos;équipe du club seulement, jamais de l&apos;adhérent. Minimums de durée et d&apos;âge du système de graduation de l&apos;IBJJF (juin 2026), à titre indicatif : le passage reste votre décision.
      </p>
    </div>
  );
}

/** Corriger ou supprimer une ligne de l'historique. Supprimer le grade actuel ramène la fiche au grade précédent (annoncé avant confirmation). */
function GradeRowActions({ row, today, actions, current, previous }: { row: GradeRow; today: string; actions: { update: FormAction; remove: FormAction }; current: boolean; previous: GradeRow | null }) {
  const what = `${BELT_LABELS[row.belt].toLowerCase()}${row.stripes > 0 ? `, ${row.stripes} barrette${row.stripes > 1 ? "s" : ""}` : ""} du ${formatCalendarDate(row.promotedOn)}`;
  return (
    <div className="flex flex-wrap items-center gap-x-5">
      <details className="text-left open:basis-full">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-[3px]">
          Corriger<span className="sr-only"> le grade {what}</span>
        </summary>
        <ActionForm action={actions.update} className="mb-2 grid max-w-md gap-3 rounded-sm border border-line bg-surface p-3 sm:grid-cols-2">
          <SelectField label="Ceinture" name="belt" required defaultValue={row.belt}>
            <BeltOptions />
          </SelectField>
          <SelectField label="Barrettes" name="stripes" defaultValue={String(row.stripes)}>
            {Array.from({ length: MAX_STRIPES + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
          <TextField label="Date" name="on" type="date" required max={today} defaultValue={row.promotedOn} className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer la correction</SubmitButton>
          </div>
        </ActionForm>
      </details>
      <ConfirmAction
        action={actions.remove}
        trigger={
          <>
            Supprimer<span className="sr-only"> le grade {what}</span>
          </>
        }
        triggerVariant="ghost"
        triggerClassName="min-h-11 px-0 text-sm underline underline-offset-[3px]"
        title="Supprimer ce grade de l'historique ?"
        description={
          <p>
            {current
              ? previous
                ? `C'est le grade actuel : la fiche reviendra au grade précédent (${BELT_LABELS[previous.belt].toLowerCase()}${previous.stripes > 0 ? `, ${previous.stripes} barrette${previous.stripes > 1 ? "s" : ""}` : ""}).`
                : "C'est le seul grade enregistré : la fiche garde ce grade, seul l'historique est vidé."
              : "Ancien grade : le grade actuel ne change pas."}
          </p>
        }
        confirmLabel="Supprimer"
      />
    </div>
  );
}
