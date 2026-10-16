"use client";

import { useState } from "react";
import Link from "next/link";
import type { ActionResult } from "@/domain/errors";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { buttonClasses } from "@/components/ui/button-classes";
import { signUpAction } from "@/server/actions/auth";

/**
 * Formulaire d'inscription. Après l'envoi, il laisse la place à un écran « Vérifiez votre boîte mail » : un formulaire vidé
 * mais toujours affiché laissait croire qu'il fallait recommencer (double inscription, inquiétude).
 */
export function SignupForm({ next, askCode }: { next: string | null; askCode: boolean }) {
  const [sent, setSent] = useState<{ email: string; message: string } | null>(null);
  const [email, setEmail] = useState("");

  if (sent) {
    return (
      <div role="status" className="rounded-sm border border-success/30 bg-success-soft p-4 text-sm text-success-ink">
        <p className="flex items-center gap-2 text-base font-bold">
          <Icon name="mail" size={20} />
          Consultez votre boîte mail
        </p>
        <p className="mt-2">{sent.message}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>
            Adresse saisie : <strong className="break-all">{sent.email}</strong>
          </li>
          <li>Ouvrez le lien « Confirmer mon adresse » de l&apos;e-mail, puis connectez-vous.</li>
          <li>Rien reçu après quelques minutes ? Regardez dans les courriers indésirables (spam).</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className={buttonClasses({ variant: "primary" })}>
            J&apos;ai confirmé : me connecter
          </Link>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={() => setSent(null)}>
            Corriger mon adresse
          </button>
        </div>
      </div>
    );
  }

  return (
    <ActionForm
      action={signUpAction}
      className="space-y-4"
      onResult={(r: ActionResult<unknown> | null) => {
        if (r?.ok) setSent({ email, message: r.message ?? "" });
      }}
    >
      {next && <input type="hidden" name="next" value={next} />}
      {askCode && (
        <TextField
          label="Code du club"
          name="clubCode"
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          hint="8 caractères, lettres et chiffres, donnés par votre club. Inutile si vous avez reçu une invitation ou un lien d'accord pour votre enfant."
        />
      )}
      <TextField label="Prénom et nom" name="displayName" autoComplete="name" hint="Visible par l'équipe de votre club." />
      <TextField label="Adresse e-mail" name="email" type="email" autoComplete="email" required onChange={(e) => setEmail(e.currentTarget.value)} />
      <TextField label="Mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} hint="12 caractères minimum. Une phrase courte est facile à retenir." />
      <p className="text-xs text-ink-soft">
        En créant un compte, vous reconnaissez avoir pris connaissance de la <Link href="/privacy">notice de confidentialité</Link>.
      </p>
      <SubmitButton pendingLabel="Création…" className="w-full">
        Créer mon compte
      </SubmitButton>
    </ActionForm>
  );
}
