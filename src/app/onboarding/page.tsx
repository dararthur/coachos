import type { Metadata } from "next";
import Link from "next/link";
import { CURRENCIES } from "@/domain/validation";
import { CURRENCY_LABELS, TIMEZONE_OPTIONS } from "@/domain/options";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { StandaloneFrame } from "@/components/layout/standalone";
import { claimClubAction } from "@/server/actions/club-requests";
import { joinWithCodeAction } from "@/server/actions/join";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { myApprovedRequest } from "@/server/repositories/club-requests";

export const metadata: Metadata = { title: "Bienvenue" };

/**
 * Compte sans club. Par défaut : rejoindre un club avec son code (le cas de presque tout le monde). La création d'un club passe par une
 * demande validée à la main ; une fois approuvée pour l'adresse de ce compte, elle apparaît ici et le club se crée en un formulaire.
 */
export default async function OnboardingPage() {
  const user = await requireUser();
  const approved = await withUser(user, (tx) => myApprovedRequest(tx));
  return (
    <StandaloneFrame width="md">
      {approved && (
        <section aria-labelledby="creer" className="mb-8">
          <h1 id="creer" className="text-title font-bold font-stretch-[80%]">
            Votre club est approuvé
          </h1>
          <p className="mb-6 mt-1 text-sm text-ink-soft">
            Vérifiez ces réglages (modifiables plus tard) puis créez votre club. Trois disciplines de départ (JJB, Grappling, MMA) sont ajoutées ; vous les adapterez dans les paramètres.
          </p>
          <div className="rounded-sm border border-line bg-surface p-6">
            <ActionForm action={claimClubAction} className="space-y-4">
              <input type="hidden" name="requestId" value={approved.id} />
              <TextField label="Nom du club" name="name" required minLength={2} maxLength={100} autoComplete="organization" defaultValue={approved.name} />
              <SelectField label="Fuseau horaire" name="timezone" defaultValue={approved.timezone} required hint="Détermine les heures des séances et les statistiques « aujourd'hui » / « cette semaine ».">
                {TIMEZONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Devise" name="currency" defaultValue={approved.currency} required>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABELS[c] ?? c}
                  </option>
                ))}
              </SelectField>
              <SubmitButton pendingLabel="Création…">Créer le club</SubmitButton>
            </ActionForm>
          </div>
        </section>
      )}
      <section aria-labelledby="rejoindre">
        {approved ? (
          <h2 id="rejoindre" className="text-lg font-bold">
            Ou rejoindre un autre club
          </h2>
        ) : (
          <h1 id="rejoindre" className="text-title font-bold font-stretch-[80%]">
            Rejoignez votre club
          </h1>
        )}
        <p className="mb-4 mt-1 text-sm text-ink-soft">Saisissez le code donné par votre club. Votre fiche de membre est créée automatiquement.</p>
        <div className="rounded-sm border border-line bg-surface p-6">
          <ActionForm action={joinWithCodeAction} className="space-y-4">
            <TextField
              label="Code du club"
              name="code"
              required
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              hint="8 caractères, lettres et chiffres."
            />
            <SubmitButton pendingLabel="Vérification…" className="w-full">
              Rejoindre
            </SubmitButton>
          </ActionForm>
        </div>
      </section>
      {!approved && (
        <p className="mt-6 text-xs text-ink-soft">
          Vous dirigez un club ? <Link href="/request-club">Demander sa création</Link>
        </p>
      )}
    </StandaloneFrame>
  );
}
