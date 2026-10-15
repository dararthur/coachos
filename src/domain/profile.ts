/** Ceintures adultes (à partir de 16 ans pour la bleue, selon l'IBJJF). */
export const ADULT_BELTS = ["white", "blue", "purple", "brown", "black"] as const;
/** Ceintures enfants IBJJF : grise (4-15 ans), jaune et orange (7-15), verte (10-15), chacune en trois degrés (blanc, plein, noir). */
export const KIDS_BELTS = [
  "grey_white", "grey", "grey_black",
  "yellow_white", "yellow", "yellow_black",
  "orange_white", "orange", "orange_black",
  "green_white", "green", "green_black",
] as const;
export const BELTS = [...ADULT_BELTS, ...KIDS_BELTS] as const;
export type Belt = (typeof BELTS)[number];
export const BELT_LABELS: Record<Belt, string> = {
  white: "Blanche", blue: "Bleue", purple: "Violette", brown: "Marron", black: "Noire",
  grey_white: "Grise et blanche", grey: "Grise", grey_black: "Grise et noire",
  yellow_white: "Jaune et blanche", yellow: "Jaune", yellow_black: "Jaune et noire",
  orange_white: "Orange et blanche", orange: "Orange", orange_black: "Orange et noire",
  green_white: "Verte et blanche", green: "Verte", green_black: "Verte et noire",
};

export const AVATAR_STYLES = ["woman", "man", "neutral"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];
export const AVATAR_LABELS: Record<AvatarStyle, string> = { woman: "Femme", man: "Homme", neutral: "Neutre" };

export const MAX_STRIPES = 4;

/** « Ceinture bleue, 2 barrettes » (lecteurs d'écran et listes). */
export function beltLabel(belt: Belt | null, stripes: number): string {
  if (!belt) return "Grade non renseigné";
  const s = stripes > 0 ? `, ${stripes} barrette${stripes > 1 ? "s" : ""}` : "";
  return `Ceinture ${BELT_LABELS[belt].toLowerCase()}${s}`;
}
