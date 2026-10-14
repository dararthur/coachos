import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { signInAction } from "@/server/actions/auth";
import { safeNext } from "@/server/actions/helpers";
import { getSessionUser } from "@/server/auth/session";
import { normalizeJoinCode } from "@/domain/join-code";
import { withApp } from "@/server/db/client";
import { clientIp, hitRateLimit, LIMITS } from "@/server/rate-limit";
import { previewJoinCodePublic } from "@/server/repositories/join";

export const metadata: Metadata = { title: "Connexion" };

/** Arrivée depuis le lien d'un club (`next=/join/<code>`) : le nom du club rappelle où mène la connexion (lecture limitée en débit). */
async function joiningClubName(next: string): Promise<string | true | null> {
  if (!next.startsWith("/join/")) return null;
  const code = normalizeJoinCode(decodeURIComponent(next.slice("/join/".length)));
  if (!code || !(await hitRateLimit("join-preview-ip", await clientIp(), LIMITS.joinCode.max, LIMITS.joinCode.window))) return true;
  return (await withApp((tx) => previewJoinCodePublic(tx, code)))?.name ?? true;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if (await getSessionUser()) redirect(safeNext(params.next, "/"));
  const joiningClub = await joiningClubName(safeNext(params.next));
  return (
    <>
      <h1 className="mb-1 text-title font-bold font-stretch-[80%]">Connexion</h1>
      <p className="mb-5 text-sm text-ink-soft">Accédez à votre club.</p>
      {joiningClub && <Alert tone="info">Connectez-vous pour terminer votre inscription au club{joiningClub === true ? "" : <> « {joiningClub} »</>} : vous y revenez juste après.</Alert>}
      {safeNext(params.next).startsWith("/checkin/") && <Alert tone="info">Vous avez ouvert un lien de pointage. Connectez-vous : vous reviendrez à la confirmation de votre présence (si le QR code a expiré, rescannez-le).</Alert>}
      {params.verified && !params.error && <Alert tone="success">Adresse e-mail confirmée. Vous pouvez vous connecter.</Alert>}
      {params.reset && <Alert tone="success">Mot de passe mis à jour. Reconnectez-vous avec votre nouveau mot de passe.</Alert>}
      {params.deleted && <Alert tone="success">Votre compte a été supprimé.</Alert>}
      {params.error && <Alert tone="danger">Ce lien est invalide ou a expiré. Recommencez la procédure (nouvelle inscription ou « Mot de passe oublié »).</Alert>}
      <ActionForm action={signInAction} className="space-y-4">
        <input type="hidden" name="next" value={safeNext(params.next)} />
        <TextField label="Adresse e-mail" name="email" type="email" autoComplete="email" required />
        <TextField label="Mot de passe" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton pendingLabel="Connexion…" className="w-full">
          Se connecter
        </SubmitButton>
      </ActionForm>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password">Mot de passe oublié ?</Link>
        <Link href="/signup">Créer un compte</Link>
      </div>
    </>
  );
}
