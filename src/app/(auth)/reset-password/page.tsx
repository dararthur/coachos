import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { resetPasswordAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Nouveau mot de passe", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // On arrive ici depuis le lien e-mail : Better Auth redirige avec ?token=… (valide) ou ?error=… (invalide, expiré).
  const params = await searchParams;
  const token = params.token;
  if (!token || params.error) {
    return (
      <>
        <h1 className="mb-1 text-title font-bold font-stretch-[80%]">Lien invalide</h1>
        <Alert tone="danger">Ce lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.</Alert>
        <p className="mt-5 text-sm">
          <Link href="/forgot-password">Mot de passe oublié</Link>
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-title font-bold font-stretch-[80%]">Nouveau mot de passe</h1>
      <p className="mb-5 text-sm text-ink-soft">Choisissez un mot de passe d&apos;au moins 12 caractères. Vos appareils connectés seront déconnectés.</p>
      <ActionForm action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <TextField label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <TextField label="Confirmation" name="confirm" type="password" autoComplete="new-password" required minLength={12} />
        <SubmitButton className="w-full">Mettre à jour</SubmitButton>
      </ActionForm>
    </>
  );
}
