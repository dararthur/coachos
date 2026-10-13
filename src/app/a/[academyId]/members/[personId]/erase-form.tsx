"use client";

import { CheckboxField } from "@/components/ui/form";

/** Champs du dialogue d'effacement (rendus dans le formulaire de ConfirmAction). */
export function EraseForm() {
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Mode d&apos;effacement</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line-strong p-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-sunken">
          <input type="radio" name="mode" value="anonymize" defaultChecked className="mt-1 accent-ink" />
          <span>
            <strong>Anonymiser</strong> (recommandé) : nom, e-mail et identifiant sont effacés ; les présences sont conservées comme statistiques non identifiantes.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line-strong p-3 text-sm has-[:checked]:border-danger has-[:checked]:bg-danger-soft">
          <input type="radio" name="mode" value="delete" className="mt-1 accent-danger" />
          <span>
            <strong>Supprimer entièrement</strong> : la fiche et toutes ses présences disparaissent des statistiques.
          </span>
        </label>
      </fieldset>
      <CheckboxField label="Je confirme vouloir effacer ces données de façon irréversible." name="confirm" required />
    </div>
  );
}
