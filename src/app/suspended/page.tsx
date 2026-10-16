import type { Metadata } from "next";
import { StandaloneFrame } from "@/components/layout/standalone";
import { EmptyState, LinkButton } from "@/components/ui/ui";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { mySuspendedClubs } from "@/server/repositories/suspension";

export const metadata: Metadata = { title: "Club suspendu", robots: { index: false } };

/** Message destiné aux membres d'un club suspendu : l'accès est fermé, les données sont conservées. */
export default async function SuspendedPage() {
  const user = await requireUser();
  const clubs = await withUser(user, (tx) => mySuspendedClubs(tx));
  return (
    <StandaloneFrame width="md">
      <EmptyState
        framed
        title={clubs.length > 1 ? "Vos clubs sont suspendus" : "Votre club est suspendu"}
        action={<LinkButton href="/academies">Mes clubs</LinkButton>}
      >
        {clubs.length > 0 ? (
          <>
            L&apos;accès à {clubs.map((c) => `« ${c.name} »`).join(", ")} est momentanément fermé. Aucune donnée n&apos;est supprimée : tout revient dès la réactivation.
          </>
        ) : (
          <>Aucun de vos clubs n&apos;est suspendu.</>
        )}{" "}
        Pour en savoir plus ou le rouvrir, écrivez à <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a>.
      </EmptyState>
    </StandaloneFrame>
  );
}
