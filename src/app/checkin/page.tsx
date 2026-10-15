import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StandaloneFrame } from "@/components/layout/standalone";
import { BackLink, PageHeader } from "@/components/ui/ui";
import { SCAN_PATH } from "@/domain/checkin";
import { getSessionUser } from "@/server/auth/session";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Pointer ma présence" };

/** `?scan=1` : ouverte depuis « Pointer ma présence » (geste explicite), la caméra démarre sans second appui. */
export default async function CheckinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { scan } = await searchParams;
  // Raccourci « Pointer ma présence » de l'application installée, ouvert hors connexion : on revient au scanner ensuite.
  if (!(await getSessionUser())) redirect(`/login?next=${encodeURIComponent(scan === "1" ? SCAN_PATH : "/checkin")}`);
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
