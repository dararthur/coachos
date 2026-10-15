import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Alert, BackLink, Card, LinkButton, PageHeader } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { ConfirmAction } from "@/components/ui/confirm";
import { deleteAccountAction, changePasswordAction, updateProfileAction } from "@/server/actions/auth";
import { getAuth } from "@/server/auth/auth";
import { listConnectedDevices } from "@/server/auth/devices";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { ChildrenCard } from "@/components/guardian/children-card";
import { myChildrenWithSessions } from "@/server/repositories/guardian";
import { InstallApp } from "@/components/ui/install-app";
import { PushToggle } from "@/components/ui/push-toggle";
import { vapidPublicKey } from "@/server/push";
import { DevicesCard } from "./devices-card";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const children = await withUser(user, (tx) => myChildrenWithSessions(tx));
  const devices = (await listConnectedDevices(getAuth(), await headers())) ?? [];
  const pushKey = vapidPublicKey();
  return (
    <StandaloneFrame>
      <PageHeader title="Mon compte" back={<BackLink href="/">Retour</BackLink>} />
      <div className="space-y-6">
      <Card title="Profil" description={`Connecté en tant que ${user.email ?? ""}`}>
        <ActionForm action={updateProfileAction} className="space-y-4">
          <TextField label="Nom affiché" name="displayName" defaultValue={user.displayName} maxLength={100} hint="Visible par l'équipe des clubs dont vous faites partie." />
          <SubmitButton>Enregistrer</SubmitButton>
        </ActionForm>
      </Card>
      <ChildrenCard childrenRows={children} />
      <Card title="Mes clubs" description="Changer de club, en rejoindre un autre ou en créer un.">
        <LinkButton href="/academies" variant="secondary">
          Voir mes clubs
        </LinkButton>
      </Card>
      <Card title="Application sur mon téléphone" description="Installez Matnexa sur l'écran d'accueil : elle s'ouvre en plein écran et vous restez connecté, sans ressaisir votre mot de passe.">
        <InstallApp />
      </Card>
      {pushKey && (
        <Card title="Notifications" description="Les annonces de vos clubs sur cet appareil. Chaque téléphone ou ordinateur s'active séparément.">
          <PushToggle publicKey={pushKey} />
        </Card>
      )}
      <DevicesCard devices={devices} />
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
