import type { Metadata } from "next";
import { LinkButton, EmptyState } from "@/components/ui/ui";
import { can } from "@/domain/roles";
import { requireAcademy } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Accès refusé" };

export default async function ForbiddenPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  return (
    <EmptyState framed title="Accès refusé" action={<LinkButton href={`/a/${academyId}/${can(ctx.role, "dashboard.read") ? "dashboard" : "me"}`}>Retour à l&apos;accueil</LinkButton>}>
      Votre rôle dans ce club ne vous permet pas d&apos;ouvrir cette page. Demandez à un administrateur si vous pensez que c&apos;est une erreur.
    </EmptyState>
  );
}
