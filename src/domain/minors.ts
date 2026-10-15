/** Âge de la majorité civile en France. */
export const ADULT_AGE = 18;
/** Âge à partir duquel un mineur peut consentir seul à un service en ligne (art. 45 loi Informatique et Libertés). */
export const DIGITAL_CONSENT_AGE = 15;

/** Date AAAA-MM-JJ du jour dans l'heure locale du serveur. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Âge révolu à la date `on` (AAAA-MM-JJ). */
export function ageOn(birthDate: string, on: string = todayIso()): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function isMinorBirthDate(birthDate: string, on: string = todayIso()): boolean {
  return ageOn(birthDate, on) < ADULT_AGE;
}
