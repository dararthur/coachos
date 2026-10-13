"use client";

import { CheckboxField } from "@/components/ui/form";

/** Champs du dialogue d'effacement (rendus dans le formulaire de ConfirmAction). */
export function EraseForm() {
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Mode d&apos;effacement</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
          <input type="radio" name="mode" value="anonymize" defaultChecked className="mt-1 accent-brand-600" />
          <span>
            <strong>Anonymiser</strong> (recommandé) : nom, e-mail et identifiant sont effacés ; les présences sont conservées comme statistiques non identifiantes.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300 p-3 text-sm has-[:checked]:border-red-600 has-[:checked]:bg-red-50">
          <input type="radio" name="mode" value="delete" className="mt-1 accent-red-700" />
          <span>
            <strong>Supprimer entièrement</strong> : la fiche et toutes ses présences disparaissent des statistiques.
          </span>
        </label>
      </fieldset>
      <CheckboxField label="Je confirme vouloir effacer ces données de façon irréversible." name="confirm" required />
    </div>
  );
}
