"use client";

import { buttonClasses } from "@/components/ui/button-classes";
import { EmptyState } from "@/components/ui/ui";

/** Erreur inattendue : rien n'est supposé enregistré ; on propose de réessayer, sans détail technique. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenu" className="mx-auto w-full max-w-xl px-4 py-12">
      <EmptyState
        framed
        title="Une erreur est survenue"
        action={
          <button type="button" className={buttonClasses()} onClick={reset}>
            Réessayer
          </button>
        }
      >
        La page n&apos;a pas pu s&apos;afficher. Si vous veniez d&apos;enregistrer quelque chose, vérifiez qu&apos;il apparaît bien avant de recommencer.
      </EmptyState>
    </main>
  );
}
