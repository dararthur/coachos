import type { Metadata } from "next";
import { StandaloneFrame } from "@/components/layout/standalone";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Alert, LinkButton } from "@/components/ui/ui";
import { formatJoinCode, normalizeJoinCode } from "@/domain/join-code";
import { joinWithCodeAction } from "@/server/actions/join";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { hitRateLimit, LIMITS } from "@/server/rate-limit";
import { previewJoinCode } from "@/server/repositories/join";

export const metadata: Metadata = { title: "Rejoindre un club", robots: { index: false } };

/** Lien de partage du club : le code est déjà saisi ; il reste à créer un compte (ou se connecter) et à confirmer. */
export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeJoinCode(decodeURIComponent(raw));
  const user = await getSessionUser();
  const next = encodeURIComponent(`/join/${code ?? ""}`);

  let clubName: string | null = null;
  let limited = false;
  if (code && user) {
    if (await hitRateLimit("join-preview", user.id, LIMITS.joinCode.max, LIMITS.joinCode.window)) {
      clubName = await withUser(user, (tx) => previewJoinCode(tx, code));
    } else limited = true;
  }

  return (
    <StandaloneFrame width="sm">
      <div className="rounded-sm border border-line bg-surface p-6">
        <h1 className="mb-2 text-title font-bold font-stretch-[80%]">Rejoindre un club</h1>
        {!code ? (
          <>
            <Alert tone="danger">Ce lien n&apos;est pas valide.</Alert>
            <LinkButton href="/join" variant="secondary">Saisir un code</LinkButton>
          </>
        ) : !user ? (
          <>
            <p className="mb-1 text-sm text-ink-soft">Vous êtes invité(e) à rejoindre un club avec le code</p>
            <p className="mb-4 font-mono text-lg font-bold tracking-widest">{formatJoinCode(code)}</p>
            <p className="mb-4 text-sm text-ink-soft">Créez votre compte (ou connectez-vous) : votre fiche de membre sera créée automatiquement.</p>
            <div className="flex flex-col gap-2">
              <LinkButton href={`/signup?next=${next}`}>Créer mon compte</LinkButton>
              <LinkButton href={`/login?next=${next}`} variant="secondary">J&apos;ai déjà un compte</LinkButton>
            </div>
          </>
        ) : limited ? (
          <Alert tone="warning">Trop de tentatives. Réessayez dans quelques minutes.</Alert>
        ) : !clubName ? (
          <>
            <Alert tone="danger">Ce code de club est inconnu ou a été remplacé. Demandez le nouveau code à votre coach.</Alert>
            <LinkButton href="/join" variant="secondary">Saisir un autre code</LinkButton>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-soft">
              Connecté en tant que <strong>{user.email}</strong>. Vous allez rejoindre le club :
            </p>
            <p className="mb-4 text-lg font-bold">{clubName}</p>
            {!user.emailConfirmed && <Alert tone="warning">Confirmez d&apos;abord votre adresse e-mail pour rejoindre le club.</Alert>}
            <ActionForm action={joinWithCodeAction} className="space-y-4">
              <input type="hidden" name="code" value={code} />
              <SubmitButton pendingLabel="Inscription…" className="w-full">
                Rejoindre {clubName}
              </SubmitButton>
            </ActionForm>
          </>
        )}
      </div>
    </StandaloneFrame>
  );
}
