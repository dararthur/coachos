import type { Metadata } from "next";
import { StandaloneFrame } from "@/components/layout/standalone";
import { BackLink, PageHeader } from "@/components/ui/ui";
import { requireUser } from "@/server/auth/guards";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Pointer ma présence" };

/** `?scan=1` : ouverte depuis « Pointer ma présence » (geste explicite), la caméra démarre sans second appui. */
export default async function CheckinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const { scan } = await searchParams;
  return (
    <StandaloneFrame width="md">
      <PageHeader
        title="Pointer ma présence"
        back={<BackLink href="/">Retour</BackLink>}
        description="Votre présence n’est enregistrée qu’après confirmation à l’étape suivante."
      />
      <Scanner autoStart={scan === "1"} />
    </StandaloneFrame>
  );
}
