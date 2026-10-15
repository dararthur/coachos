import type { Metadata } from "next";
import { Card, PageHeader, BackLink } from "@/components/ui/ui";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { createMemberAction } from "@/server/actions/members";
import { requireAcademy } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Nouveau membre" };

export default async function NewMemberPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  await requireAcademy(academyId, "members.create");
  return (
    <>
      <PageHeader title="Nouveau membre" back={<BackLink href={`/a/${academyId}/members`}>Membres</BackLink>} />
      <Card className="max-w-xl">
        <ActionForm action={createMemberAction.bind(null, academyId)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Prénom" name="firstName" required maxLength={80} autoComplete="off" />
            <TextField label="Nom" name="lastName" required maxLength={80} autoComplete="off" />
          </div>
          <SelectField label="Type de membre" name="ageGroup" required defaultValue="">
            <option value="" disabled>
              Choisir…
            </option>
            <option value="adult">Majeur (18 ans ou plus)</option>
            <option value="minor">Mineur (moins de 18 ans)</option>
          </SelectField>
          <fieldset className="space-y-4 rounded-sm border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Membre majeur</legend>
            <TextField label="E-mail" name="email" type="email" maxLength={254} autoComplete="off" hint="Facultatif. Sert à éviter les doublons et à inviter le membre à se connecter." />
            <TextField label="Téléphone" name="phone" type="tel" inputMode="tel" maxLength={30} autoComplete="off" hint="Facultatif. Pour le recontacter sur WhatsApp. Ex. : 06 12 34 56 78." />
            <CheckboxField label="Je confirme que ce membre est majeur." name="adultConfirmed" hint="À cocher pour un membre majeur." />
          </fieldset>
          <fieldset className="space-y-4 rounded-sm border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Membre mineur : à remplir seulement pour un mineur</legend>
            <p className="text-sm text-ink-soft">
              Le responsable légal reçoit un lien pour confirmer son accord. Les messages (WhatsApp, e-mail) lui sont adressés, jamais à l&apos;enfant. Le classement et la photo sont désactivés par défaut.
            </p>
            <TextField label="Date de naissance" name="birthDate" type="date" hint="Effacée automatiquement à la majorité." />
            <TextField label="Nom du responsable légal" name="guardianName" maxLength={80} autoComplete="off" />
            <TextField label="E-mail du responsable légal" name="guardianEmail" type="email" maxLength={254} autoComplete="off" />
            <TextField label="Téléphone du responsable légal" name="guardianPhone" type="tel" inputMode="tel" maxLength={30} autoComplete="off" hint="Facultatif. Pour le recontacter sur WhatsApp." />
          </fieldset>
          <TextField label="Date d'inscription" name="joinedOn" type="date" hint="Facultatif." />
          <p className="text-sm text-ink-soft">N&apos;enregistrez aucune donnée de santé ni de blessure.</p>
          <SubmitButton>Créer le membre</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
