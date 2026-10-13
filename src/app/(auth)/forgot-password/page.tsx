import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { requestPasswordResetAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-title font-bold font-stretch-[80%]">Mot de passe oublié</h1>
      <p className="mb-5 text-sm text-ink-soft">Indiquez votre adresse e-mail : si un compte existe, vous recevrez un lien de réinitialisation.</p>
      <ActionForm action={requestPasswordResetAction} className="space-y-4">
        <TextField label="Adresse e-mail" name="email" type="email" autoComplete="email" required />
        <SubmitButton pendingLabel="Envoi…" className="w-full">
          Envoyer le lien
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-sm">
        <Link href="/login">Retour à la connexion</Link>
      </p>
    </>
  );
}
