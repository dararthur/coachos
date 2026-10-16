/**
 * Cycle de vie d'un membre : pause déclarée et motif de départ (roadmap P1.5, migration 20261016000600).
 *
 * « Blessure » et « malade » sont des DONNÉES DE SANTÉ (RGPD art. 9) : consentement explicite obligatoire, aucun détail libre,
 * visibles du seul staff du club et de la personne (voir la migration). Ces listes sont fermées et reprises par des contraintes
 * de la base : toute valeur ajoutée ici doit l'être aussi dans la migration.
 */

export const PAUSE_REASONS = [
  { value: "injury", emoji: "🩹", label: "Blessure", health: true },
  { value: "sick", emoji: "🤒", label: "Malade", health: true },
  { value: "schedule", emoji: "🕐", label: "Horaires", health: false },
  { value: "travel", emoji: "✈️", label: "Vacances ou déplacement", health: false },
  { value: "personal", emoji: "🏠", label: "Raison personnelle", health: false },
  { value: "other", emoji: "⏸️", label: "Autre", health: false },
  { value: "undisclosed", emoji: "🔒", label: "Ne souhaite pas s'exprimer", health: false },
] as const;

export type PauseReason = (typeof PAUSE_REASONS)[number]["value"];
export const PAUSE_VALUES = PAUSE_REASONS.map((r) => r.value) as [PauseReason, ...PauseReason[]];

export function pauseReasonInfo(value: string | null | undefined) {
  return PAUSE_REASONS.find((r) => r.value === value) ?? null;
}

export const isHealthReason = (value: string | null | undefined) => pauseReasonInfo(value)?.health === true;

/** Durée maximale d'une pause à sa pose (la base applique la même limite). */
export const MAX_PAUSE_DAYS = 366;

export const DEPARTURE_REASONS = [
  { value: "moved", emoji: "📦", label: "Déménagement" },
  { value: "schedule", emoji: "🕐", label: "Horaires" },
  { value: "price", emoji: "💶", label: "Prix" },
  { value: "level_or_vibe", emoji: "🥋", label: "Niveau ou ambiance" },
  { value: "personal", emoji: "🏠", label: "Raison personnelle" },
  { value: "other", emoji: "⏸️", label: "Autre" },
  { value: "undisclosed", emoji: "🔒", label: "Ne souhaite pas s'exprimer" },
  { value: "unknown", emoji: "❓", label: "Non précisé" },
] as const;

export type DepartureReason = (typeof DEPARTURE_REASONS)[number]["value"];
export const DEPARTURE_VALUES = DEPARTURE_REASONS.map((r) => r.value) as [DepartureReason, ...DepartureReason[]];

/** Une pause est « en cours » tant que sa date de reprise n'est pas passée (comparaison de dates calendaires AAAA-MM-JJ). */
export function isPaused(pausedUntil: string | null | undefined, today: string): boolean {
  return Boolean(pausedUntil) && (pausedUntil as string) >= today;
}
