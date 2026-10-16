import type { Belt } from "./profile";

/**
 * Passages de ceinture : éligibilité INDICATIVE selon le « General System of Graduation » de l'IBJJF (version de juin 2026,
 * art. 2 « Minimum ages » et art. 3 « Minimum period »). Le club reste libre de ses passages : l'IBJJF ne reconnaît un grade que s'il respecte
 * ces minimums, mais « le temps pour passer de la ceinture blanche à la noire est à la discrétion du professeur » (art. 3, observations).
 *
 * Cette date n'est destinée qu'à l'équipe (propriétaire, administrateur, coach) : elle n'est jamais montrée à l'adhérent.
 *
 * Règles reprises (adultes, à partir de 16 ans) :
 *   - âge minimum : bleue 16, violette 16, marron 18, noire 19 (18 seulement pour un champion du monde adulte à la ceinture marron : non calculé) ;
 *   - durée minimale à la ceinture avant de passer à la suivante : bleue 2 ans (1 an si l'athlète a été gris, jaune ou orange ; aucune s'il a été vert),
 *     violette 1 an et demi, marron 1 an ; blanche : aucune ;
 *   - la durée est comptée depuis le jour de la ceinture, pas des barrettes (degrés) ;
 *   - l'âge IBJJF est « année en cours − année de naissance » : on devient éligible le 1er janvier de l'année des 16, 18 ou 19 ans ;
 * Règles reprises (enfants, 4 à 15 ans) : aucune durée minimale ; groupes gris (dès 4 ans), jaune (7), orange (10), vert (13) ; à 16 ans on passe aux
 * ceintures adultes (gris, jaune, orange → bleue ; vert → bleue ou violette au choix du professeur).
 *
 * NON CALCULÉ (à signaler à l'équipe) : l'exception « champion du monde adulte » (aucune durée), les réductions liées à une ceinture bleue ou violette
 * « juvénile », et les degrés de la ceinture noire.
 */

export type BeltGroup = "white" | "grey" | "yellow" | "orange" | "green" | "blue" | "purple" | "brown" | "black";

export const GROUP_LABELS: Record<BeltGroup, string> = {
  white: "blanche", grey: "grise", yellow: "jaune", orange: "orange", green: "verte", blue: "bleue", purple: "violette", brown: "marron", black: "noire",
};

/** Ordre des groupes : blanche, puis les groupes enfants, puis les ceintures adultes. */
const KIDS_ORDER: BeltGroup[] = ["white", "grey", "yellow", "orange", "green"];
const ADULT_ORDER: BeltGroup[] = ["white", "blue", "purple", "brown", "black"];

/** Âge minimum (IBJJF art. 2.1) pour recevoir chaque groupe. */
export const MIN_AGE: Record<BeltGroup, number> = { white: 0, grey: 4, yellow: 7, orange: 10, green: 13, blue: 16, purple: 16, brown: 18, black: 19 };

/** Durée minimale (en mois) à passer dans un groupe avant d'accéder au suivant (IBJJF art. 3.1.3). */
export const MIN_MONTHS_AT: Partial<Record<BeltGroup, number>> = { blue: 24, purple: 18, brown: 12 };

export function beltGroup(belt: Belt): BeltGroup {
  return belt.replace(/_(white|black)$/, "") as BeltGroup;
}

export type PromotionEntry = { belt: Belt; stripes: number; promotedOn: string; confirmed: boolean };

export type Eligibility = {
  /** Groupe suivant, ou null (ceinture noire, ou rien à calculer). */
  next: BeltGroup | null;
  /**
   * `no_minimum` : aucun minimum ne s'oppose au passage (le coach décide) ;
   * `waiting` : un minimum n'est pas encore atteint ; `eligible` : tous les minimums sont atteints ;
   * `date_unknown` : il manque la date du passage à la ceinture actuelle pour calculer la durée ; `none` : pas de ceinture suivante.
   */
  status: "none" | "no_minimum" | "waiting" | "eligible" | "date_unknown";
  /** Date (AAAA-MM-JJ) à laquelle tous les minimums connus sont atteints. */
  eligibleOn: string | null;
  /** Début de la ceinture actuelle (couleur), si l'historique le donne ; `sinceConfirmed` : cette date a été confirmée par l'équipe. */
  since: string | null;
  sinceConfirmed: boolean;
  minMonths: number;
  /** Date où la durée minimale est atteinte, et date où l'âge minimum est atteint. */
  timeDate: string | null;
  ageDate: string | null;
  /** Passage obligatoire : un enfant qui atteint l'année de ses 16 ans passe aux ceintures adultes (IBJJF art. 2.2.3). */
  due: boolean;
  /** Mentions à afficher à l'équipe (vérifications que la base ne peut pas faire). */
  notes: string[];
};

const NONE: Eligibility = { next: null, status: "none", eligibleOn: null, since: null, sinceConfirmed: false, minMonths: 0, timeDate: null, ageDate: null, due: false, notes: [] };

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Âge IBJJF : année en cours moins année de naissance (art. 2.2.1). */
export function ibjjfAge(birthDate: string, today: string): number {
  return Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
}

/** Premier jour de l'année où la personne atteint `age` selon la règle IBJJF. */
const dateReachingAge = (birthDate: string, age: number) => `${Number(birthDate.slice(0, 4)) + age}-01-01`;

/** Début de la ceinture (couleur) actuelle : le plus ancien passage de la dernière série de lignes de même groupe. */
function currentRunStart(history: PromotionEntry[], group: BeltGroup): PromotionEntry | null {
  const sorted = [...history].sort((a, b) => (a.promotedOn < b.promotedOn ? -1 : a.promotedOn > b.promotedOn ? 1 : 0));
  let start: PromotionEntry | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]!;
    if (beltGroup(e.belt) !== group) break;
    start = e;
  }
  return start;
}

export function assessEligibility(i: { belt: Belt | null; birthDate: string | null; history: PromotionEntry[]; today: string }): Eligibility {
  if (!i.belt) return NONE;
  const group = beltGroup(i.belt);
  if (group === "black") return NONE;

  const age = i.birthDate ? ibjjfAge(i.birthDate, i.today) : null;
  // Sans date de naissance : adulte (la date est effacée à la majorité). Avec : l'âge IBJJF décide de la filière.
  const kidsTrack = age !== null && age <= 15 && group !== "blue" && group !== "purple" && group !== "brown";
  const due = age !== null && age >= 16 && (group === "grey" || group === "yellow" || group === "orange" || group === "green");
  const order = kidsTrack ? KIDS_ORDER : ADULT_ORDER;

  let next: BeltGroup | null;
  const notes: string[] = [];
  if (due) {
    next = "blue";
    notes.push(group === "green" ? "À 16 ans, passage obligatoire aux ceintures adultes : bleue ou violette, au choix du professeur (IBJJF art. 2.2.3)." : "À 16 ans, passage obligatoire à la ceinture bleue (IBJJF art. 2.2.3).");
  } else {
    const idx = order.indexOf(group);
    next = idx >= 0 ? (order[idx + 1] ?? null) : null;
    // Un enfant de ceinture blanche reçoit d'abord une ceinture enfant ; un adulte la bleue.
    if (group === "white" && kidsTrack) next = "grey";
    if (kidsTrack && group === "green") next = "blue";
  }
  if (!next) return { ...NONE, notes };

  const start = currentRunStart(i.history, group);
  const since = start?.promotedOn ?? null;
  const sinceConfirmed = Boolean(start?.confirmed);

  // Durée minimale (adultes uniquement), avec les réductions liées aux anciennes ceintures enfants.
  let minMonths = kidsTrack || due ? 0 : (MIN_MONTHS_AT[group] ?? 0);
  if (group === "blue" && minMonths > 0) {
    const kidsGroups = new Set(i.history.map((h) => beltGroup(h.belt)));
    if (kidsGroups.has("green")) minMonths = 0;
    else if (kidsGroups.has("grey") || kidsGroups.has("yellow") || kidsGroups.has("orange")) minMonths = 12;
  }

  // Âge minimum pour la ceinture visée. Sans date de naissance, la personne est adulte (18 ans attestés) : seule la noire (19 ans) reste à vérifier.
  let ageDate: string | null = null;
  if (i.birthDate) {
    const needed = MIN_AGE[next];
    if (needed > 0) ageDate = dateReachingAge(i.birthDate, needed);
  } else if (next === "black") {
    notes.push("Âge minimum de la ceinture noire : 19 ans (18 ans pour un champion du monde adulte à la ceinture marron). L'âge n'est pas conservé pour un adulte : à vérifier.");
  }

  const timeDate = minMonths > 0 && since && sinceConfirmed ? addMonths(since, minMonths) : null;
  const dates = [timeDate, ageDate].filter((d): d is string => d !== null);
  const eligibleOn = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;

  const base = { next, since, sinceConfirmed, minMonths, timeDate, ageDate, due, notes };
  if (minMonths > 0 && !(since && sinceConfirmed)) return { ...base, status: "date_unknown", eligibleOn };
  if (eligibleOn === null) return { ...base, status: "no_minimum", eligibleOn: null };
  // Un âge déjà atteint sans durée minimale n'est pas une « éligibilité » à signaler : rien ne retient la personne.
  if (minMonths === 0 && !due && ageDate && ageDate <= i.today) return { ...base, status: "no_minimum", eligibleOn: null };
  return { ...base, status: eligibleOn <= i.today ? "eligible" : "waiting", eligibleOn };
}

/** « Ceinture bleue » pour une phrase : le groupe suivant en toutes lettres. */
export const nextBeltLabel = (g: BeltGroup) => `ceinture ${GROUP_LABELS[g]}`;

/** Nombre de jours avant l'éligibilité (négatif si dépassée). */
export function daysUntil(eligibleOn: string, today: string): number {
  return Math.round((Date.parse(`${eligibleOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
