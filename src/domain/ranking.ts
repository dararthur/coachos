import { addDays, mondayOf } from "./dates";

export const RANKING_PERIODS = ["semaine", "mois", "annee"] as const;
export type RankingPeriod = (typeof RANKING_PERIODS)[number];

export const RANKING_LABELS: Record<RankingPeriod, string> = { semaine: "Cette semaine", mois: "Ce mois-ci", annee: "Cette année" };

export function parseRankingPeriod(value: unknown): RankingPeriod {
  return RANKING_PERIODS.includes(value as RankingPeriod) ? (value as RankingPeriod) : "mois";
}

/** Bornes [from, to[ en dates locales du club : semaine ISO (lundi), mois civil ou année civile en cours. */
export function rankingRange(period: RankingPeriod, today: string): { from: string; to: string } {
  if (period === "semaine") {
    const from = mondayOf(today);
    return { from, to: addDays(from, 7) };
  }
  const [y, m] = today.split("-").map(Number) as [number, number];
  if (period === "annee") return { from: `${y}-01-01`, to: `${y + 1}-01-01` };
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: next };
}

/** « 1er », « 2e »… */
export const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);
