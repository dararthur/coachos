import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Alert } from "@/components/ui/ui";
import { acceptInvitationAction } from "@/server/actions/team";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <main id="contenu" className="mx-auto w-full max-w-md px-4 pb-12 pt-[max(3rem,env(safe-area-inset-top))]">
      <div className="rounded-sm border border-line bg-surface p-6">
        <h1 className="mb-2 text-xl font-semibold">Rejoindre un club</h1>
        <p className="mb-4 text-sm text-ink-soft">
          Vous êtes connecté en tant que <strong>{user.email}</strong>. L&apos;invitation n&apos;est valable que pour l&apos;adresse e-mail à laquelle elle a été envoyée.
        </p>
        {!user.emailConfirmed && <Alert tone="warning">Confirmez d&apos;abord votre adresse e-mail pour accepter l&apos;invitation.</Alert>}
        <ActionForm action={acceptInvitationAction.bind(null, token)} className="space-y-4">
          <SubmitButton pendingLabel="Validation…">Accepter l&apos;invitation</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
