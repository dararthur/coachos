import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { signInAction } from "@/server/actions/auth";
import { safeNext } from "@/server/actions/helpers";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if (await getSessionUser()) redirect(safeNext(params.next, "/"));
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Connexion</h1>
      <p className="mb-5 text-sm text-muted">Accédez à votre club.</p>
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
