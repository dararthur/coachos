import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { signUpAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-title font-bold font-stretch-[80%]">Créer un compte</h1>
      <p className="mb-5 text-sm text-ink-soft">Vous pourrez ensuite créer votre club ou rejoindre celui qui vous invite.</p>
      <ActionForm action={signUpAction} className="space-y-4">
        <TextField label="Nom affiché" name="displayName" autoComplete="name" hint="Visible par l'équipe de votre club." />
        <TextField label="Adresse e-mail" name="email" type="email" autoComplete="email" required />
        <TextField label="Mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} hint="12 caractères minimum." />
        <p className="text-xs text-ink-soft">
          En créant un compte, vous reconnaissez avoir pris connaissance de la <Link href="/privacy">notice de confidentialité</Link>.
        </p>
        <SubmitButton pendingLabel="Création…" className="w-full">
          Créer mon compte
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-sm">
        Déjà inscrit ? <Link href="/login">Se connecter</Link>
      </p>
    </>
  );
}
