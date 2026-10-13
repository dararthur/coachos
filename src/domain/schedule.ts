import { addDays, daysBetween, isoWeekday } from "./dates";
import { MAX_OCCURRENCES } from "./validation";

export interface RecurrenceInput {
  /** Première date (YYYY-MM-DD, dans le fuseau de l'académie). */
  date: string;
  repeat: "none" | "weekly";
  /** Jours ISO : 1 = lundi … 7 = dimanche. */
  weekdays: readonly number[];
  until?: string;
}

/**
 * Dates calendaires locales des séances à créer. L'heure et le fuseau sont appliqués par PostgreSQL
 * (`(date + heure) AT TIME ZONE fuseau`), ce qui gère correctement les changements d'heure.
 * Retourne au plus MAX_OCCURRENCES + 1 dates, pour que l'appelant puisse détecter le dépassement.
 */
export function expandOccurrences(input: RecurrenceInput): string[] {
  if (input.repeat === "none") return [input.date];
  if (!input.until) return [input.date];
  const weekdays = new Set(input.weekdays);
  const span = daysBetween(input.date, input.until);
  const out: string[] = [];
  for (let offset = 0; offset <= span; offset++) {
    const date = addDays(input.date, offset);
    if (weekdays.has(isoWeekday(date))) {
      out.push(date);
      if (out.length > MAX_OCCURRENCES) break;
    }
  }
  return out;
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};
