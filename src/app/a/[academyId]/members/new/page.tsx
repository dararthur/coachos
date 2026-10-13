import type { Metadata } from "next";
import { Card, PageHeader, BackLink } from "@/components/ui/ui";
import { ActionForm, CheckboxField, SubmitButton, TextField } from "@/components/ui/form";
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
          <TextField label="E-mail" name="email" type="email" maxLength={254} autoComplete="off" hint="Facultatif. Sert à éviter les doublons et à inviter le membre à se connecter." />
          <TextField label="Date d'inscription" name="joinedOn" type="date" hint="Facultatif." />
          <CheckboxField
            label="Je confirme que ce membre est majeur."
            name="adultConfirmed"
            required
            hint="Matnexa est réservé aux adhérents adultes. N'enregistrez aucune donnée de santé ni de blessure."
          />
          <SubmitButton>Créer le membre</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
