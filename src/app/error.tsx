"use client";

import { useSyncExternalStore } from "react";
import { buttonClasses } from "@/components/ui/button-classes";
import { EmptyState } from "@/components/ui/ui";

function onConnectivityChange(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/**
 * Erreur inattendue : rien n'est supposé enregistré ; on propose de réessayer, sans détail technique. Hors connexion (cas le plus
 * fréquent sur téléphone, dans une salle mal couverte), on le dit plutôt qu'une « erreur » qui inquiète sans expliquer.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const offline = useSyncExternalStore(onConnectivityChange, () => !navigator.onLine, () => false);
  return (
    <main id="contenu" className="mx-auto w-full max-w-xl px-4 py-12">
      <EmptyState
        framed
        title={offline ? "Pas de connexion internet" : "Une erreur est survenue"}
        action={
          <button type="button" className={buttonClasses()} onClick={reset}>
            Réessayer
          </button>
        }
      >
        {offline
          ? "Votre téléphone ne capte pas le réseau. Rapprochez-vous du Wi-Fi ou activez les données mobiles, puis réessayez. Si vous veniez d'enregistrer quelque chose, vérifiez qu'il apparaît bien."
          : "La page n'a pas pu s'afficher. Si vous veniez d'enregistrer quelque chose, vérifiez qu'il apparaît bien avant de recommencer."}
      </EmptyState>
    </main>
  );
}
