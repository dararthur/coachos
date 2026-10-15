import type { Metadata } from "next";
import Link from "next/link";
import { CURRENCIES } from "@/domain/validation";
import { CURRENCY_LABELS, TIMEZONE_OPTIONS } from "@/domain/options";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { StandaloneFrame } from "@/components/layout/standalone";
import { requestClubAction } from "@/server/actions/club-requests";

export const metadata: Metadata = { title: "Demander la création d'un club" };

export default function RequestClubPage() {
  return (
    <StandaloneFrame width="md">
      <h1 className="text-title font-bold font-stretch-[80%]">Demander la création de votre club</h1>
      <p className="mb-6 mt-1 text-sm text-ink-soft">
        La création d&apos;un club est validée à la main. Une fois votre demande examinée, vous recevez un e-mail avec la marche à suivre pour créer votre compte et votre club.
      </p>
      <div className="rounded-sm border border-line bg-surface p-6">
        <ActionForm action={requestClubAction} className="space-y-4">
          <TextField label="Nom du club" name="name" required minLength={2} maxLength={100} autoComplete="organization" />
          <TextField label="Votre nom" name="contactName" required maxLength={80} autoComplete="name" />
          <TextField label="Votre adresse e-mail" name="email" type="email" required autoComplete="email" hint="Celle de votre futur compte : la réponse y sera envoyée." />
          <SelectField label="Fuseau horaire" name="timezone" defaultValue="Europe/Paris" required>
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
          <TextAreaField label="Un mot sur votre club (facultatif)" name="note" maxLength={500} hint="Ville, discipline, nombre d'adhérents… N'indiquez aucune information sur la santé ni sur une autre personne." />
          {/* Piège à robots : un humain ne voit jamais ce champ. */}
          <div className="hidden">
            <label>
              Ne pas remplir
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <SubmitButton pendingLabel="Envoi…" className="w-full">
            Envoyer ma demande
          </SubmitButton>
        </ActionForm>
      </div>
      <p className="mt-5 text-sm">
        Vous êtes membre d&apos;un club ? <Link href="/signup">Créer un compte avec le code du club</Link>
      </p>
    </StandaloneFrame>
  );
}
