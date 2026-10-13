import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { updatePasswordAction } from "@/server/actions/auth";
import { getSessionUser } from "@/server/auth/supabase";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function ResetPasswordPage() {
  // On arrive ici depuis le lien e-mail (session de récupération posée par /auth/callback).
  if (!(await getSessionUser())) redirect("/login?error=callback");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Nouveau mot de passe</h1>
      <p className="mb-5 text-sm text-muted">Choisissez un mot de passe d&apos;au moins 12 caractères.</p>
      <ActionForm action={updatePasswordAction} className="space-y-4">
        <TextField label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <TextField label="Confirmation" name="confirm" type="password" autoComplete="new-password" required minLength={12} />
        <SubmitButton className="w-full">Mettre à jour</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-sm">
        <Link href="/">Continuer vers mes clubs</Link>
      </p>
    </>
  );
}
