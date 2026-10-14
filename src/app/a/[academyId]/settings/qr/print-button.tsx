"use client";

import { buttonClasses } from "@/components/ui/button-classes";

export function PrintButton() {
  return (
    <button type="button" className={buttonClasses()} onClick={() => window.print()}>
      Imprimer l&apos;affiche
    </button>
  );
}
