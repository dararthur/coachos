/**
 * Modules activables club par club par l'administrateur de la plateforme (table club_features, migration 000900).
 * Par défaut tout est activé. Une fonctionnalité coupée est masquée dans la navigation, refusée par le serveur et par la base,
 * et les données déjà saisies sont conservées.
 */
export const FEATURES = {
  ranking: {
    label: "Classement et assiduité",
    covers: "Page Classement et son export, rang du mois dans « Mon espace » et après un pointage, réglage « Apparaître au classement ».",
  },
  news: {
    label: "Actualités et notifications",
    covers: "Page Actualités (lecture et publication) et notification envoyée aux membres à chaque publication.",
  },
  reports: {
    label: "Grades et rapports",
    covers: "Page Rapports et son export, historique des passages de ceinture, éligibilité indicative et liste « Passages à évaluer ».",
  },
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_IDS = Object.keys(FEATURES) as Feature[];

export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && Object.hasOwn(FEATURES, value);
}
