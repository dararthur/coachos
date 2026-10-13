import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, LinkButton } from "@/components/ui/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { ConfirmAction } from "@/components/ui/confirm";
import { deleteAccountAction, signOutAction, updatePasswordAction, updateProfileAction } from "@/server/actions/auth";
import { buttonClasses } from "@/components/ui/button-classes";
import { requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mon compte</h1>
        <Link href="/academies">← Mes clubs</Link>
      </div>
      <Card title="Profil" description={`Connecté en tant que ${user.email ?? ""}`}>
        <ActionForm action={updateProfileAction} className="space-y-4">
          <TextField label="Nom affiché" name="displayName" defaultValue={user.displayName} maxLength={100} hint="Visible par l'équipe des clubs dont vous faites partie." />
          <SubmitButton>Enregistrer</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Session">
        <form action={signOutAction}>
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>
            Se déconnecter
          </button>
        </form>
      </Card>
      <Card title="Mot de passe">
        <ActionForm action={updatePasswordAction} className="space-y-4" resetOnSuccess>
          <TextField label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" minLength={12} required />
          <TextField label="Confirmation" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          <SubmitButton>Changer le mot de passe</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Mes données personnelles" description="Droits d'accès, de portabilité et d'effacement (RGPD).">
        <p className="mb-4 text-sm text-muted">
          Vous pouvez télécharger l&apos;ensemble des données associées à votre compte (profil, appartenances aux clubs, fiches membre vous concernant et leurs présences).
          Pour exercer vos droits auprès d&apos;un club (rectification, effacement de votre fiche membre), adressez-vous à ses responsables ; voir la <Link href="/privacy">notice de confidentialité</Link>.
        </p>
        <LinkButton href="/account/export" variant="secondary" download>
          Télécharger mes données (JSON)
        </LinkButton>
      </Card>
      <Card title="Supprimer mon compte">
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
    </main>
  );
}
