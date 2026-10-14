import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AVATAR_LABELS, AVATAR_STYLES, BELT_LABELS, BELTS, MAX_STRIPES } from "@/domain/profile";
import { formatPhone } from "@/domain/phone";
import { Alert, BackLink, Card, PageHeader } from "@/components/ui/ui";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { updateMyProfileAction } from "@/server/actions/members";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getMyProfile } from "@/server/repositories/profile";

export const metadata: Metadata = { title: "Mon profil" };

/** Profil du membre connecté : sa fiche est créée à son arrivée dans le club, il la complète ici. */
export default async function ProfilePage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  const me = await inAcademy(ctx, (tx) => getMyProfile(tx, academyId));
  // Les comptes d'équipe (propriétaire, administrateur, coach) n'ont pas de fiche membre.
  if (!me) notFound();

  return (
    <>
      <PageHeader
        title="Mon profil"
        back={me.completed ? <BackLink href={`/a/${academyId}/me`}>Mon espace</BackLink> : undefined}
        description={`Vos informations dans « ${ctx.academy.name} ».`}
      />
      {!me.completed && (
        <Alert tone="info" title="Bienvenue !">
          Vérifiez vos informations et indiquez votre grade. Votre fiche a été créée automatiquement : le coach n&apos;a rien à faire.
        </Alert>
      )}
      <Card className="max-w-xl">
        <ActionForm action={updateMyProfileAction.bind(null, academyId)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Prénom" name="firstName" defaultValue={me.firstName} required maxLength={80} autoComplete="given-name" />
            <TextField label="Nom" name="lastName" defaultValue={me.lastName === "·" ? "" : me.lastName} required maxLength={80} autoComplete="family-name" />
          </div>
          <TextField
            label="Téléphone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={me.phone ? formatPhone(me.phone) : null}
            maxLength={30}
            autoComplete="tel"
            hint="Facultatif. Le coach peut ainsi vous écrire sur WhatsApp."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Ceinture" name="belt" defaultValue={me.belt ?? ""} hint="Facultatif.">
              <option value="">Non renseigné</option>
              {BELTS.map((b) => (
                <option key={b} value={b}>
                  {BELT_LABELS[b]}
                </option>
              ))}
            </SelectField>
            <SelectField label="Barrettes" name="beltStripes" defaultValue={String(me.beltStripes)}>
              {Array.from({ length: MAX_STRIPES + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectField>
          </div>
          <SelectField label="Silhouette" name="avatarStyle" defaultValue={me.avatarStyle} hint="Affichée à la place d'une photo.">
            {AVATAR_STYLES.map((a) => (
              <option key={a} value={a}>
                {AVATAR_LABELS[a]}
              </option>
            ))}
          </SelectField>
          {!me.adultAttested && <CheckboxField label="Je confirme être majeur(e)." name="adultConfirmed" required hint="Matnexa est réservé aux adultes." />}
          <SubmitButton>{me.completed ? "Enregistrer" : "Valider mon profil"}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
