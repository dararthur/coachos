import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Alert, LinkButton } from "@/components/ui/ui";
import { formatJoinCode, normalizeJoinCode } from "@/domain/join-code";
import { joinWithCodeAction } from "@/server/actions/join";
import { getSessionUser } from "@/server/auth/session";
import { withApp, withUser } from "@/server/db/client";
import { clientIp, hitRateLimit, LIMITS } from "@/server/rate-limit";
import { isMemberOf, previewJoinCodePublic } from "@/server/repositories/join";

export const metadata: Metadata = { title: "Rejoindre un club", robots: { index: false } };

/**
 * Lien de partage du club : le code est déjà saisi. Le visiteur voit d'abord le NOM du club (vérifier que c'est le bon
 * avant de donner son e-mail), puis le chemin en trois étapes ; connecté, il rejoint en un geste. Lecture limitée en
 * débit par compte, ou par adresse IP sans compte.
 */
export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeJoinCode(decodeURIComponent(raw));
  const user = await getSessionUser();
  const next = encodeURIComponent(`/join/${code ?? ""}`);

  let club: { academyId: string; name: string } | null = null;
  let limited = false;
  let alreadyMember = false;
  if (code) {
    if (await hitRateLimit(user ? "join-preview" : "join-preview-ip", user ? user.id : await clientIp(), LIMITS.joinCode.max, LIMITS.joinCode.window)) {
      club = await withApp((tx) => previewJoinCodePublic(tx, code));
      if (club && user) alreadyMember = await withUser(user, (tx) => isMemberOf(tx, club!.academyId));
    } else limited = true;
  }

  if (!code || (!club && !limited)) {
    return (
      <>
        <h1 className="mb-3 text-title font-bold font-stretch-[80%]">Rejoindre un club</h1>
        <Alert tone="danger">{code ? "Ce lien d'inscription est inconnu ou a été remplacé. Demandez le lien à jour à votre coach." : "Ce lien n'est pas valide."}</Alert>
        <LinkButton href="/join" variant="secondary">
          Saisir un code
        </LinkButton>
      </>
    );
  }
  if (limited || !club) {
    return (
      <>
        <h1 className="mb-3 text-title font-bold font-stretch-[80%]">Rejoindre un club</h1>
        <Alert tone="warning">Trop de tentatives. Réessayez dans quelques minutes.</Alert>
      </>
    );
  }

  return (
    <>
      <h1 className="text-title font-bold font-stretch-[80%]">Rejoindre « {club.name} »</h1>
      <p className="mb-5 mt-1 text-sm text-ink-soft">
        Code du club : <span className="font-semibold tracking-wide text-ink tabular-nums">{formatJoinCode(code)}</span>
      </p>

      {!user ? (
        <>
          <ol className="mb-6 space-y-3 text-sm">
            {[
              ["Créez votre compte", "avec vos prénom et nom, tels que le club les connaît."],
              ["Confirmez votre adresse e-mail", "puis connectez-vous : vous revenez ici."],
              ["Rejoignez le club en un geste", "et complétez votre profil (ceinture, photo facultative)."],
            ].map(([title, detail], i) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-xs bg-ink text-xs font-bold text-white tabular-nums">
                  {i + 1}
                </span>
                <span>
                  <span className="font-semibold">{title}</span> <span className="text-ink-soft">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2">
            <LinkButton href={`/signup?next=${next}`}>Créer mon compte</LinkButton>
            <LinkButton href={`/login?next=${next}`} variant="secondary">
              J&apos;ai déjà un compte
            </LinkButton>
          </div>
        </>
      ) : alreadyMember ? (
        <>
          <p className="mb-4 text-sm">
            Vous êtes déjà membre de ce club, connecté en tant que <strong>{user.email}</strong>.
          </p>
          <LinkButton href={`/a/${club.academyId}/me`} className="w-full">
            Aller à Mon espace
          </LinkButton>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-soft">
            Connecté en tant que <strong className="text-ink">{user.email}</strong>. Votre fiche de membre sera créée automatiquement.
          </p>
          {!user.emailConfirmed && <Alert tone="warning">Confirmez d&apos;abord votre adresse e-mail pour rejoindre le club.</Alert>}
          <ActionForm action={joinWithCodeAction} className="space-y-4">
            <input type="hidden" name="code" value={code} />
            <SubmitButton pendingLabel="Inscription…" className="w-full">
              Rejoindre {club.name}
            </SubmitButton>
          </ActionForm>
        </>
      )}
    </>
  );
}
