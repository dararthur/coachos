import type { MonthPoint } from "@/domain/club-alerts";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const label = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(2, 4)}`;

/**
 * Usage par mois sur 13 mois, en bandes (même langage visuel que les présences par semaine). Les hauteurs passent par des
 * attributs SVG (la CSP interdit les attributs style en ligne). Le mois en cours, incomplet, est grisé. Liste lisible telle quelle
 * par les lecteurs d'écran.
 */
export function UsageChart({ points }: { points: MonthPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.total));
  return (
    <ol className="grid grid-cols-13 items-end gap-1 sm:gap-2">
      {points.map((p, i) => {
        const current = i === points.length - 1;
        const h = p.total === 0 ? 0 : Math.max(3, Math.round((p.total / max) * 100));
        return (
          <li key={p.month} className="flex min-w-0 flex-col items-center gap-1">
            <span className="text-xs font-bold tabular-nums">
              {p.total}
              <span className="sr-only"> événements en {label(p.month)}{current ? " (mois en cours)" : ""}</span>
            </span>
            <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="h-24 w-full max-w-8 rounded-xs" aria-hidden="true" focusable="false">
              <rect x="0" y="0" width="10" height="100" className="fill-sunken" />
              {h > 0 && <rect x="0" y={100 - h} width="10" height={h} className={current ? "fill-line-strong" : "fill-ink"} />}
            </svg>
            <span aria-hidden="true" className={`text-[10px] leading-3 sm:text-xs ${current ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {label(p.month).split(" ")[0]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
