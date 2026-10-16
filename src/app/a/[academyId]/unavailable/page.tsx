import type { Metadata } from "next";
import { EmptyState, LinkButton } from "@/components/ui/ui";
import { FEATURES, isFeature } from "@/domain/features";
import { can } from "@/domain/roles";
import { requireAcademy } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Non incluse dans votre formule" };

/** Destination d'une page dont le module est coupé pour le club (voir requireAcademy). */
export default async function UnavailablePage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { academyId } = await params;
  const { feature } = await searchParams;
  const ctx = await requireAcademy(academyId);
  const label = isFeature(feature) ? FEATURES[feature].label : "Cette fonctionnalité";
  const staff = can(ctx.role, "academy.update");
  return (
    <EmptyState framed title="Non incluse dans votre formule" action={<LinkButton href={`/a/${academyId}/${can(ctx.role, "dashboard.read") ? "dashboard" : "me"}`}>Retour à l&apos;accueil</LinkButton>}>
      {label} n&apos;est pas activée pour « {ctx.academy.name} ».{" "}
      {staff ? (
        <>
          Pour l&apos;activer, écrivez à <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a>. Vos données sont conservées.
        </>
      ) : (
        <>Demandez à l&apos;équipe de votre club.</>
      )}
    </EmptyState>
  );
}
