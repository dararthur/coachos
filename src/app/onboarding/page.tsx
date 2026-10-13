import type { Metadata } from "next";
import { CURRENCIES } from "@/domain/validation";
import { CURRENCY_LABELS, TIMEZONE_OPTIONS } from "@/domain/options";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { createAcademyAction } from "@/server/actions/academy";
import { StandaloneFrame } from "@/components/layout/standalone";
import { requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Créer votre club" };

export default async function OnboardingPage() {
  await requireUser();
  return (
    <StandaloneFrame width="md">
      <h1 className="text-title font-bold font-stretch-[80%]">Créez votre club</h1>
      <p className="mb-6 mt-1 text-sm text-ink-soft">
        Ces réglages pourront être modifiés plus tard. Trois disciplines de départ (JJB, Grappling, MMA) sont ajoutées ; vous les adapterez dans les paramètres.
      </p>
      <div className="rounded-sm border border-line bg-surface p-6">
        <ActionForm action={createAcademyAction} className="space-y-4">
          <TextField label="Nom du club" name="name" required minLength={2} maxLength={100} autoComplete="organization" />
          <SelectField label="Fuseau horaire" name="timezone" defaultValue="Europe/Paris" required hint="Détermine les heures des séances et les statistiques « aujourd'hui » / « cette semaine ».">
            {TIMEZONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Devise" name="currency" defaultValue="EUR" required>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c] ?? c}
              </option>
            ))}
          </SelectField>
          <SubmitButton pendingLabel="Création…">Créer le club</SubmitButton>
        </ActionForm>
      </div>
    </StandaloneFrame>
  );
}
