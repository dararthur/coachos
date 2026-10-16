import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StandaloneFrame } from "@/components/layout/standalone";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { Card, LinkButton, PageHeader } from "@/components/ui/ui";
import { formatTime } from "@/domain/dates";
import { lockAdminAction, sendAdminCodeAction, verifyAdminCodeAction } from "@/server/actions/admin-security";
import { hasAdminProof } from "@/server/auth/admin-proof";
import { isPlatformAdminAccount } from "@/server/auth/platform-admin";
import { getSessionUser } from "@/server/auth/session";
import { adminCodePending } from "@/server/repositories/admin-2fa";

export const metadata: Metadata = { title: "Vérification en deux étapes", robots: { index: false } };

function adminNext(next: string | undefined): string {
  return next && /^\/admin(\/[A-Za-z0-9_\-/]*)?$/.test(next) && !next.startsWith("/admin/security") ? next : "/admin";
}

/** Seconde authentification de l'administrateur : code à 6 chiffres envoyé par e-mail. 404 pour tout autre compte. */
export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin/security")}`);
  if (!(await isPlatformAdminAccount(user))) notFound();
  const next = adminNext((await searchParams).next);
  const proof = await hasAdminProof(user);
  const pending = proof ? null : await adminCodePending(user.id, user.sessionId);

  return (
    <StandaloneFrame width="md">
      <PageHeader title="Vérification en deux étapes" description="L'administration de la plateforme exige, en plus de votre mot de passe, un code reçu par e-mail." />
      <div className="space-y-6">
        {proof ? (
          <Card title="Administration déverrouillée" description="Cet appareil est vérifié pour 8 heures.">
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/admin">Ouvrir l&apos;administration</LinkButton>
              <ActionForm action={lockAdminAction}>
                <SubmitButton variant="secondary">Verrouiller sur cet appareil</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        ) : (
          <>
            {pending && (
              <Card title="Saisir le code" description={`Un code a été envoyé à l'adresse de votre compte. Il est valable jusqu'à ${formatTime(pending, "Europe/Paris")}.`}>
                <ActionForm action={verifyAdminCodeAction.bind(null, next)} className="space-y-4">
                  <TextField label="Code à 6 chiffres" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={12} />
                  <SubmitButton pendingLabel="Vérification…">Ouvrir l&apos;administration</SubmitButton>
                </ActionForm>
              </Card>
            )}
            <Card
              title={pending ? "Pas reçu ?" : "Recevoir un code"}
              description={pending ? "Un nouveau code remplace le précédent. Vérifiez aussi vos courriers indésirables." : "Un code à 6 chiffres sera envoyé à l'adresse e-mail de votre compte."}
            >
              <ActionForm action={sendAdminCodeAction}>
                <SubmitButton variant={pending ? "secondary" : "primary"} pendingLabel="Envoi…">
                  {pending ? "Renvoyer un code" : "Envoyer le code par e-mail"}
                </SubmitButton>
              </ActionForm>
            </Card>
          </>
        )}
      </div>
    </StandaloneFrame>
  );
}
