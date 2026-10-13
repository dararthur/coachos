import type { Metadata } from "next";
import { StandaloneFrame } from "@/components/layout/standalone";
import { BackLink, PageHeader } from "@/components/ui/ui";
import { requireUser } from "@/server/auth/guards";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Pointer ma présence" };

export default async function CheckinPage() {
  await requireUser();
  return (
    <StandaloneFrame width="md">
      <PageHeader
        title="Pointer ma présence"
        back={<BackLink href="/">Retour</BackLink>}
        description="Votre présence n’est enregistrée qu’après confirmation à l’étape suivante."
      />
      <Scanner />
    </StandaloneFrame>
  );
}
