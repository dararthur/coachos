import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { joinWithCodeAction } from "@/server/actions/join";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Rejoindre un club", robots: { index: false } };

export default async function JoinPage() {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/join")}`);
  return (
    <>
      <h1 className="mb-2 text-title font-bold font-stretch-[80%]">Rejoindre un club</h1>
      <p className="mb-4 text-sm text-ink-soft">Saisissez le code donné par votre club. Votre fiche de membre est créée automatiquement.</p>
      <ActionForm action={joinWithCodeAction} className="space-y-4">
        <TextField
          label="Code du club"
          name="code"
          required
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          hint="8 caractères, lettres et chiffres."
        />
        <SubmitButton pendingLabel="Vérification…" className="w-full">
          Rejoindre
        </SubmitButton>
      </ActionForm>
    </>
  );
}
