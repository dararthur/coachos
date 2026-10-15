import type { Metadata } from "next";
import Link from "next/link";
import { Alert, BackLink, Card, LinkButton, PageHeader } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { ConfirmAction } from "@/components/ui/confirm";
import { deleteAccountAction, signOutAction, changePasswordAction, updateProfileAction } from "@/server/actions/auth";
import { buttonClasses } from "@/components/ui/button-classes";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { setChildRankingAction, withdrawChildConsentAction } from "@/server/actions/guardian";
import { myChildren } from "@/server/repositories/guardian";
import { formatCalendarDate } from "@/domain/dates";
import { MinorAccountForm } from "./minor-account-form";
import { InstallApp } from "@/components/ui/install-app";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const children = await withUser(user, (tx) => myChildren(tx));
  return (
    <StandaloneFrame>
      <PageHeader title="Mon compte" back={<BackLink href="/academies">Mes clubs</BackLink>} />
      <div className="space-y-6">
      <Card title="Profil" description={`Connecté en tant que ${user.email ?? ""}`}>
        <ActionForm action={updateProfileAction} className="space-y-4">
          <TextField label="Nom affiché" name="displayName" defaultValue={user.displayName} maxLength={100} hint="Visible par l'équipe des clubs dont vous faites partie." />
          <SubmitButton>Enregistrer</SubmitButton>
        </ActionForm>
      </Card>
      {children.length > 0 && (
        <Card title="Mes enfants" description="Les fiches des mineurs dont vous êtes le responsable légal.">
          <ul className="divide-y divide-line">
            {children.map((c) => (
              <li key={c.childId} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <p className="font-semibold">
                  {c.firstName} {c.lastName} <span className="font-normal text-ink-soft">· {c.academyName}</span>
                </p>
                <p className="text-sm text-ink-soft">
                  {c.consentWithdrawnAt
                    ? "Accord retiré : fiche archivée."
                    : c.consentConfirmedAt
                      ? `Accord confirmé. ${c.lastAttendedAt ? `Dernier cours : ${formatCalendarDate(c.lastAttendedAt.toISOString().slice(0, 10))}.` : "Aucun cours enregistré pour l'instant."}`
                      : "Accord en attente : utilisez le lien reçu par e-mail."}
                </p>
                {c.consentConfirmedAt && !c.consentWithdrawnAt && (
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={setChildRankingAction.bind(null, c.childId, !c.rankingOptIn)}>
                      <SubmitButton variant="secondary">{c.rankingOptIn ? "Retirer du classement" : "Afficher au classement"}</SubmitButton>
                    </ActionForm>
                    <ConfirmAction
                      action={withdrawChildConsentAction.bind(null, c.childId)}
                      trigger="Retirer mon accord…"
                      title="Retirer votre accord ?"
                      description={<p>La fiche de {c.firstName} sera archivée, sa photo supprimée et le classement désactivé. Le club l&apos;anonymisera ensuite.</p>}
                      confirmLabel="Retirer l'accord"
                    />
                  </div>
                )}
                {c.consentConfirmedAt && !c.consentWithdrawnAt && c.canHaveAccount && (
                  c.hasAccount ? <p className="text-sm text-ink-soft">{c.firstName} a un compte propre.</p> : <MinorAccountForm childId={c.childId} firstName={c.firstName} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Application sur mon téléphone" description="Installez Matnexa sur l'écran d'accueil : elle s'ouvre en plein écran et vous restez connecté, sans ressaisir votre mot de passe.">
        <InstallApp />
      </Card>
      <Card title="Session">
        <form action={signOutAction}>
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>
            Se déconnecter
          </button>
        </form>
      </Card>
      <Card title="Mot de passe">
        {params.updated === "password" && <Alert tone="success">Mot de passe mis à jour. Vos autres appareils ont été déconnectés.</Alert>}
        <ActionForm action={changePasswordAction} className="space-y-4" resetOnSuccess>
          <TextField label="Mot de passe actuel" name="currentPassword" type="password" autoComplete="current-password" required />
          <TextField label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" minLength={12} required />
          <TextField label="Confirmation" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          <SubmitButton variant="secondary">Changer le mot de passe</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Mes données personnelles" description="Droits d'accès, de portabilité et d'effacement (RGPD).">
        <p className="mb-4 text-sm text-ink-soft">
          Vous pouvez télécharger l&apos;ensemble des données associées à votre compte (profil, appartenances aux clubs, fiches membre vous concernant et leurs présences).
          Pour exercer vos droits auprès d&apos;un club (rectification, effacement de votre fiche membre), adressez-vous à ses responsables ; voir la <Link href="/privacy">notice de confidentialité</Link>.
        </p>
        <LinkButton href="/account/export" variant="secondary" download>
          Télécharger mes données (JSON)
        </LinkButton>
      </Card>
      <Card title="Supprimer mon compte" className="border-danger/40">
        <Alert tone="warning">
          Action définitive. Si vous êtes le seul propriétaire d&apos;un club, vous devez d&apos;abord nommer un autre propriétaire ou supprimer le club.
        </Alert>
        <ConfirmAction
          action={deleteAccountAction}
          trigger="Supprimer mon compte"
          title="Supprimer définitivement votre compte ?"
          description={
            <>
              <p>Votre accès, votre profil et vos appartenances seront supprimés. Les fiches membres que les clubs ont créées à votre nom restent gérées par ces clubs.</p>
              <p>Pour confirmer, saisissez votre adresse e-mail : <strong>{user.email}</strong></p>
            </>
          }
          confirmLabel="Supprimer définitivement"
        >
          <TextField label="Adresse e-mail" name="confirm" type="email" required autoComplete="off" />
        </ConfirmAction>
      </Card>
      </div>
    </StandaloneFrame>
  );
}
