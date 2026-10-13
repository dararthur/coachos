/**
 * Présences par semaine, en bandes. Les hauteurs passent par des attributs SVG (la CSP interdit les attributs style en ligne).
 * Liste ordonnée lisible telle quelle par les lecteurs d'écran ; la semaine en cours, incomplète, est grisée.
 */
export function WeeklyBars({ weeks }: { weeks: { weekStart: string; attended: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.attended));
  return (
    <ol className="grid grid-cols-8 items-end gap-1.5 sm:gap-3">
      {weeks.map((w, i) => {
        const current = i === weeks.length - 1;
        const h = Math.max(2, Math.round((w.attended / max) * 100));
        const label = `${w.weekStart.slice(8)}/${w.weekStart.slice(5, 7)}`;
        return (
          <li key={w.weekStart} className="flex min-w-0 flex-col items-center gap-1.5">
            <span className="text-sm font-bold">
              {w.attended}
              <span className="sr-only"> présences, semaine du {label}{current ? " (en cours)" : ""}</span>
            </span>
            <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="h-28 w-full max-w-12" aria-hidden="true" focusable="false">
              <rect x="0" y={100 - h} width="10" height={h} className={current ? "fill-[#b9b2a6]" : "fill-ink"} />
            </svg>
            <span aria-hidden="true" className={`text-xs ${current ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
