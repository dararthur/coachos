import type { Metadata } from "next";
import { StandaloneFrame } from "@/components/layout/standalone";
import { EmptyState, LinkButton } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <StandaloneFrame width="md">
      <EmptyState framed title="Page introuvable" action={<LinkButton href="/">Retour à l&apos;accueil</LinkButton>}>
        Cette page n&apos;existe pas ou n&apos;est plus disponible. Si vous avez suivi un lien de pointage ou d&apos;invitation, il a peut-être expiré.
      </EmptyState>
    </StandaloneFrame>
  );
}
