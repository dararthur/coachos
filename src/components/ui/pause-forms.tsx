import { addDays } from "@/domain/dates";
import { MAX_PAUSE_DAYS, PAUSE_REASONS } from "@/domain/lifecycle";
import {
  ActionForm,
  CheckboxField,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/ui/form";
import { PauseBadge } from "@/components/ui/pause-badge";
import type { ActionResult } from "@/domain/errors";

type FormAction = (
  prev: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown> | null>;

/**
 * Pause d'un adhérent : saisie (raison d'une liste fermée avec vignette, date de reprise) et levée. Utilisée par le staff sur la fiche
 * d'un membre et par l'adhérent sur « Mon profil ». « Blessure » et « Malade » sont des données de santé : la case de consentement
 * est exigée par la base pour ces deux raisons, et AUCUN détail libre n'est saisissable (voir docs/rgpd/pauses-sante.md).
 */
export function PauseForm({
  mode,
  setAction,
  clearAction,
  reason,
  until,
  today,
  minor = false,
}: {
  mode: "staff" | "member";
  setAction: FormAction;
  clearAction: FormAction;
  reason: string | null;
  until: string | null;
  /** Date du jour (AAAA-MM-JJ, fuseau du club). */
  today: string;
  /** Mineur : pas de raison de santé (voir la migration). */
  minor?: boolean;
}) {
  const active = Boolean(reason && until && until >= today);
  const ended = Boolean(reason && until && until < today);
  return (
    <div className="space-y-4">
      {reason && until && (
        <div className="flex flex-wrap items-center gap-3">
          <PauseBadge reason={reason} until={until} />
          {ended && (
            <span className="text-sm text-ink-soft">Pause terminée</span>
          )}
          <ActionForm
            action={clearAction}
            className="inline-flex"
            hideMessage={false}
          >
            <SubmitButton variant="secondary" pendingLabel="…">
              {active
                ? mode === "staff"
                  ? "Lever la pause"
                  : "Reprendre maintenant"
                : "Effacer"}
            </SubmitButton>
          </ActionForm>
        </div>
      )}
      <ActionForm action={setAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Raison"
            name="reason"
            required
            defaultValue={reason ?? ""}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {PAUSE_REASONS.map((r) => (
              <option
                key={r.value}
                value={r.value}
                disabled={minor && r.health}
              >
                {r.emoji} {r.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Reprise prévue le"
            name="until"
            type="date"
            required
            min={today}
            max={addDays(today, MAX_PAUSE_DAYS)}
            defaultValue={until ?? undefined}
          />
          <CheckboxField
            className="sm:col-span-2"
            label={
              mode === "staff"
                ? "La personne m'a informé(e) de cette situation et accepte que l'équipe du club la note."
                : "J'accepte que l'équipe de mon club (coachs et administrateurs) voie cette information."
            }
            name="consent"
            hint="Obligatoire pour « Blessure » et « Malade » (donnée de santé). Aucun détail médical n'est demandé ni enregistré."
          />
        </div>
        <SubmitButton>
          {reason ? "Mettre à jour la pause" : "Enregistrer la pause"}
        </SubmitButton>
      </ActionForm>
      <p className="text-sm text-ink-soft">
        {mode === "staff"
          ? "Visible de l'équipe du club (propriétaire, administrateurs, coachs) et de la personne, jamais des autres adhérents. Effacée 30 jours après la reprise, à l'archivage et à l'anonymisation."
          : "Visible de l'équipe de votre club, jamais des autres adhérents. Pendant la pause, vous n'êtes plus signalé(e) comme absent(e). Effacée 30 jours après la reprise."}
      </p>
    </div>
  );
}
