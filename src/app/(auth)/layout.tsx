import Link from "next/link";
import type { ReactNode } from "react";
import { MatnexaLogo } from "@/components/brand/logo";

/**
 * Écrans d'authentification. Grand écran : à gauche le bout de ceinture (barre noire et ses quatre bandes de ruban),
 * à droite le formulaire. Aucun élément focalisable avant le premier champ (le premier Tab mène à l'e-mail).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BeltPanel />
      <main id="contenu" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <div className="mb-8 lg:hidden">
          <MatnexaLogo />
        </div>
        <div className="rounded-sm border border-line bg-surface p-6 sm:p-7">{children}</div>
        <p className="mt-6 text-center text-xs text-ink-soft">
          <Link href="/privacy">Confidentialité et données personnelles</Link>
        </p>
      </main>
    </div>
  );
}
/** Volet de marque (≥ lg) : le bout de ceinture. Décoratif, sans lien ni contrôle. */
function BeltPanel() {
  return (
    <div data-surface="bar" className="relative hidden overflow-hidden bg-bar text-bar-text lg:flex lg:flex-col lg:justify-between lg:p-12">
      <MatnexaLogo size="lg" tone="light" />
      <div aria-hidden="true" className="absolute inset-y-0 right-16 flex gap-4">
        <span className="w-5 bg-white" />
        <span className="w-5 bg-white" />
        <span className="w-5 bg-white" />
        <span className="w-5 bg-white" />
      </div>
      <p className="relative max-w-xs text-lg font-semibold font-stretch-[87.5%] leading-snug text-bar-muted">
        Membres, planning et présences des clubs de JJB, de grappling et de MMA.
      </p>
    </div>
  );
}