import { assiduityLabel } from "@/domain/assiduity";

export { weeksAttended, weeksFromMondays } from "@/domain/assiduity";

/** Barrette compacte pour une ligne de liste : une bande blanche par semaine avec une venue. */
export function TallyBar({ weeks }: { weeks: boolean[] }) {
  return (
    <span role="img" aria-label={assiduityLabel(weeks)} title={assiduityLabel(weeks)} className="tally tally-sm">
      {weeks.map((on, i) => (
        <span key={i} data-on={on} />
      ))}
    </span>
  );
}

/**
 * Barrette d'assiduité : la bande noire de la ceinture, une bande de ruban blanc par semaine avec au moins une venue.
 * `taped` : la bande de la semaine en cours vient d'être gagnée (pointage) ; elle se pose comme un ruban qu'on colle.
 */
export function Tally({ weeks, size = "md", taped = false }: { weeks: boolean[]; size?: "md" | "lg"; taped?: boolean }) {
  return (
    <div className={`tally ${size === "lg" ? "tally-lg" : ""}`} aria-hidden="true">
      {weeks.map((on, i) => (
        <span key={i} data-on={on} data-taped={taped && i === weeks.length - 1 ? true : undefined} />
      ))}
    </div>
  );
}

export function Assiduity({ weeks }: { weeks: boolean[] }) {
  return (
    <div className="flex items-center gap-4 rounded-sm border border-line bg-surface px-4 py-3.5">
      <Tally weeks={weeks} />
      <div className="text-sm">
        <h2 className="font-semibold">Assiduité</h2>
        <p className="text-ink-soft">{assiduityLabel(weeks)}</p>
      </div>
    </div>
  );
}
