import { addDays, localDate, mondayOf } from "./dates";
import { rankingRange } from "./ranking";

export const ASSIDUITY_WEEKS = 8;

/** Une venue = présent ou en retard (une absence ne compte pas). */
const came = (h: { status: string }) => h.status !== "absent";

/** Lundis (AAAA-MM-JJ, fuseau du club) des 8 dernières semaines, la plus ancienne d'abord. */
function lastMondays(tz: string, now = new Date()): string[] {
  const thisMonday = mondayOf(localDate(now, tz));
  return Array.from({ length: ASSIDUITY_WEEKS }, (_, i) => addDays(thisMonday, -7 * (ASSIDUITY_WEEKS - 1 - i)));
}

/** À partir des lundis des semaines avec une venue (ex. `attendedWeeks` de la liste des membres). */
export function weeksFromMondays(attended: string[] | undefined, tz: string, now = new Date()): boolean[] {
  const seen = new Set(attended ?? []);
  return lastMondays(tz, now).map((m) => seen.has(m));
}

/** Pour chacune des 8 dernières semaines (la plus ancienne d'abord) : au moins une venue (présent ou en retard) ? */
export function weeksAttended(history: { startsAt: Date; status: string }[], tz: string, now = new Date()): boolean[] {
  return weeksFromMondays(
    history.filter(came).map((h) => mondayOf(localDate(h.startsAt, tz))),
    tz,
    now,
  );
}

/** « 7 semaines sur 8 avec une venue » : sans « Venu(e) », la phrase reste juste quel que soit le genre. */
export function assiduityLabel(weeks: boolean[]): string {
  const n = weeks.filter(Boolean).length;
  return `${n} semaine${n > 1 ? "s" : ""} sur ${weeks.length} avec une venue`;
}

export interface MonthRank {
  rank: number | null;
  /** Autres membres au même rang (ex æquo). */
  tied: boolean;
  rankedTotal: number;
}

/** Rang du membre connecté dans un classement (lignes renvoyées par `attendance_ranking`). */
export function myRank(rows: { rank: number | null; isMe: boolean; rankedTotal: number }[]): MonthRank {
  const me = rows.find((r) => r.isMe);
  const rank = me?.rank ?? null;
  return { rank, tied: rank !== null && rows.filter((r) => r.rank === rank).length > 1, rankedTotal: rows[0]?.rankedTotal ?? 0 };
}

export interface CheckinProgress extends MonthRank {
  weeks: boolean[];
  /** Première venue de la semaine : la barrette de la semaine vient de s'allumer. */
  newStripe: boolean;
  monthVisits: number;
}

/** Ce que le membre vient de gagner en pointant : la barrette de la semaine, ses venues du mois, son rang. */
export function checkinProgress(
  history: { startsAt: Date; status: string }[],
  ranking: { rank: number | null; isMe: boolean; rankedTotal: number }[],
  tz: string,
  now = new Date(),
): CheckinProgress {
  const today = localDate(now, tz);
  const thisMonday = mondayOf(today);
  const { from, to } = rankingRange("mois", today);
  const visits = history.filter(came);
  const thisWeek = visits.filter((h) => mondayOf(localDate(h.startsAt, tz)) === thisMonday).length;
  const monthVisits = visits.filter((h) => {
    const d = localDate(h.startsAt, tz);
    return d >= from && d < to;
  }).length;
  return { weeks: weeksAttended(history, tz, now), newStripe: thisWeek === 1, monthVisits, ...myRank(ranking) };
}
