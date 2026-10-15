import type { Metadata } from "next";
import Link from "next/link";
import { StandaloneFrame } from "@/components/layout/standalone";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Alert, LinkButton } from "@/components/ui/ui";
import { confirmGuardianConsentAction } from "@/server/actions/guardian";
import { hashToken } from "@/server/actions/helpers";
import { getSessionUser } from "@/server/auth/session";
import { withApp } from "@/server/db/client";
import { clientIp, hitRateLimit } from "@/server/rate-limit";
import { previewConsent } from "@/server/repositories/guardian";

export const metadata: Metadata = { title: "Accord du responsable légal", robots: { index: false }, referrer: "no-referrer" };

/**
 * Lien reçu par e-mail par le responsable légal d'un mineur. L'ouverture de la page ne confirme RIEN (les messageries ouvrent
 * les liens à l'avance) : l'accord n'est enregistré que par le bouton. Aucune connexion requise ; connecté, le compte est
 * rattaché à la fiche de l'enfant pour suivre son inscription depuis « Mon compte ».
 */
export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  const allowed = await hitRateLimit("guardian-consent-view", user ? user.id : await clientIp(), 30, 15 * 60);
  const preview = allowed && token.length >= 20 && token.length <= 100 ? await withApp((tx) => previewConsent(tx, hashToken(token))) : null;

  return (
    <StandaloneFrame width="sm">
      <div className="rounded-sm border border-line bg-surface p-6">
        <h1 className="mb-3 text-title font-bold font-stretch-[80%]">Accord du responsable légal</h1>
        {!allowed ? (
          <Alert tone="warning">Trop de tentatives. Réessayez dans quelques minutes.</Alert>
        ) : !preview ? (
          <Alert tone="danger">Ce lien est invalide ou a expiré. Demandez au club de vous en envoyer un nouveau.</Alert>
        ) : (
          <>
            <p className="mb-3 text-sm">
              Le club <strong>{preview.academyName}</strong> souhaite inscrire <strong>{preview.childFirstName}</strong> sur Matnexa, pour le suivi des présences aux cours.
            </p>
            <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
              <li>Aucune donnée de santé n&apos;est collectée.</li>
              <li>Les messages du club sont adressés à vous, jamais à votre enfant.</li>
              <li>L&apos;affichage au classement et la photo sont désactivés ; vous seul pouvez les activer.</li>
              <li>Vous pouvez retirer votre accord à tout moment : la fiche est alors archivée.</li>
            </ul>
            <p className="mb-4 text-sm text-ink-soft">
              En confirmant, vous déclarez être le responsable légal de cet enfant. Voir la <Link href="/privacy">notice de confidentialité</Link>.
            </p>
            <ActionForm action={confirmGuardianConsentAction.bind(null, token)} className="space-y-4">
              <SubmitButton pendingLabel="Enregistrement…" className="w-full">
                {preview.state === "already" ? (user ? "Rattacher à mon compte" : "Accord déjà enregistré") : "Je confirme mon accord"}
              </SubmitButton>
            </ActionForm>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              {user ? (
                <LinkButton href="/account" variant="secondary">
                  Suivre mon enfant depuis Mon compte
                </LinkButton>
              ) : (
                <LinkButton href={`/login?next=${encodeURIComponent(`/consent/${token}`)}`} variant="secondary">
                  Me connecter pour suivre mon enfant (facultatif)
                </LinkButton>
              )}
            </div>
          </>
        )}
      </div>
    </StandaloneFrame>
  );
}
