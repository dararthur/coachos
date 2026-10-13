/** Utilitaires de dates sans dépendance. Les dates calendaires sont des chaînes `YYYY-MM-DD`. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FR_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Lit strictement `YYYY-MM-DD` ou `JJ/MM/AAAA` (jour d'abord, séparateurs / . -).
 * Aucune interprétation mois-jour : une date ambiguë est donc toujours lue jour-mois.
 * Retourne null si le format est inconnu ou si la date n'existe pas (ex. 31/02/2025).
 */
export function parseCalendarDate(input: string): string | null {
  const value = input.trim();
  let match = ISO_DATE.exec(value);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidCalendarDate(y, m, d) ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : null;
  }
  match = FR_DATE.exec(value);
  if (match) {
    const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidCalendarDate(y, m, d) ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : null;
  }
  return null;
}

function parseIso(date: string): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Date invalide : ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIso(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return toIso(parseIso(date) + days * 86_400_000);
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: string): number {
  const day = new Date(parseIso(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to) - parseIso(from)) / 86_400_000);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Date calendaire (YYYY-MM-DD) d'un instant dans un fuseau donné. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function toDate(instant: Date | string): Date {
  return typeof instant === "string" ? new Date(instant) : instant;
}

export function formatDateTime(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(toDate(instant));
}

export function formatTime(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(toDate(instant));
}

export function formatDay(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(
    toDate(instant),
  );
}

export function formatCalendarDate(date: string): string {
  if (!ISO_DATE.test(date)) return date;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(parseIso(date)),
  );
}
