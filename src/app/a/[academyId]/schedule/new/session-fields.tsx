"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/ui/form";

interface TypeOption {
  id: string;
  label: string;
  durationMinutes: number;
}

/**
 * Type de cours, coach, date, heure et durée. La durée se préremplit avec celle du type choisi (réglée dans les paramètres) et se
 * recale à chaque changement de type ; on peut ensuite la modifier pour la séance.
 */
export function SessionFields({ types, instructors, today }: { types: TypeOption[]; instructors: { id: string; name: string }[]; today: string }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const duration = types.find((t) => t.id === typeId)?.durationMinutes ?? 60;
  return (
    <>
      <SelectField label="Type de cours" name="classTypeId" required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <SelectField label="Coach" name="instructorId" hint="Facultatif. Un coach n'enregistre les présences que des séances qui lui sont affectées (ou sans coach). Le coach affecté est ajouté d'office à la liste des inscrits.">
        <option value="">Aucun coach assigné</option>
        {instructors.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Date de la première séance" name="date" type="date" defaultValue={today} required />
        <TextField label="Heure de début" name="time" type="time" defaultValue="18:30" required />
        <TextField key={typeId} label="Durée (minutes)" name="durationMinutes" type="number" defaultValue={duration} min={15} max={360} step={5} required hint="Reprise du type de cours." />
      </div>
    </>
  );
}
