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
            {/* Barre noire de la ceinture, remplie de ruban blanc ; un filet noir tous les 10 présents (les « bandes »). */}
            <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="h-28 w-full max-w-12 rounded-xs" aria-hidden="true" focusable="false">
              <rect x="0" y="0" width="10" height="100" className="fill-ink" />
              <rect x="1.5" y={Math.min(98.5, 100 - h + 1.5)} width="7" height={Math.max(0, h - 3)} className={current ? "fill-bar-muted" : "fill-white"} />
              {Array.from({ length: Math.floor(w.attended / 10) }, (_, k) => {
                const y = 100 - ((k + 1) * 10 * 100) / max;
                return y > 100 - h + 3 ? <rect key={k} x="0" y={y} width="10" height="1.2" className="fill-ink" /> : null;
              })}
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
