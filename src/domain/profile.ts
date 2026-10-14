export const BELTS = ["white", "blue", "purple", "brown", "black"] as const;
export type Belt = (typeof BELTS)[number];
export const BELT_LABELS: Record<Belt, string> = { white: "Blanche", blue: "Bleue", purple: "Violette", brown: "Marron", black: "Noire" };

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
