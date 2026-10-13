"use client";

import { useEffect, useRef, useState } from "react";
import { TextField } from "@/components/ui/form";
import { recurrenceLimit } from "@/domain/validation";

/**
 * « Répéter jusqu'au » : préremplie au 31 décembre de l'année de la première séance, et bornée (min / max) pour que
 * le sélecteur de date grise les jours hors limite. Suit les changements du champ « Date de la première séance ».
 * La règle reste vérifiée côté serveur (sessionCreateSchema).
 */
export function RecurrenceEnd({ firstDate }: { firstDate: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(firstDate);

  useEffect(() => {
    const until = box.current?.querySelector<HTMLInputElement>("input[name=until]");
    const date = until?.form?.elements.namedItem("date");
    if (!until || !(date instanceof HTMLInputElement)) return;
    const sync = () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return;
      const previousLimit = recurrenceLimit(start);
      setStart(date.value);
      // Valeur jamais modifiée à la main : elle suit la fin de l'année de la nouvelle première séance.
      if (until.value === previousLimit || !until.value) until.value = recurrenceLimit(date.value);
    };
    date.addEventListener("change", sync);
    return () => date.removeEventListener("change", sync);
  }, [start]);

  return (
    <div ref={box}>
      <TextField
        label="Répéter jusqu'au"
        name="until"
        type="date"
        defaultValue={recurrenceLimit(firstDate)}
        min={start}
        max={recurrenceLimit(start)}
        hint="Au plus tard le 31 décembre de l'année de la première séance. Les créneaux déjà existants sont ignorés."
      />
    </div>
  );
}
