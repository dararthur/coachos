import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Pointer ma présence" };

export default async function CheckinPage() {
  await requireUser();
  return (
    <main id="contenu" className="mx-auto w-full max-w-xl px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <Link href="/" className="inline-flex min-h-11 items-center">
        ← Retour
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold tracking-tight">Pointer ma présence</h1>
      <p className="mb-5 text-sm text-muted">Votre présence n&apos;est enregistrée qu&apos;après confirmation à l&apos;étape suivante.</p>
      <Scanner />
    </main>
  );
}
