export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "quiet";

// Boutons « bande » : coins de 4 px, 44 px de haut minimum (cible tactile), libellé en graisse 600.
const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-semibold leading-5 no-underline transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  // Action principale : orange ceinture, une par zone.
  primary: "bg-accent text-white hover:bg-accent-strong active:bg-accent-strong",
  // Action secondaire : encre sur blanc, filet noir.
  secondary: "border border-ink/80 bg-surface text-ink hover:bg-sunken active:bg-sunken",
  danger: "bg-danger text-white hover:bg-danger-strong active:bg-danger-strong",
  ghost: "text-ink hover:bg-sunken active:bg-sunken",
  // Action discrète dans une ligne de liste (même cible tactile, sans fond).
  quiet: "text-ink underline decoration-ink/40 underline-offset-[3px] hover:decoration-ink",
};

/**
 * Classes d'un bouton. `className` l'emporte sur les classes de base et de variante :
 * dans la feuille Tailwind, l'ordre des règles ne suit pas l'ordre des classes (`px-4` est
 * émis après `px-3` et gagne), donc une classe de l'appelant qui touche la même propriété
 * (même groupe, même préfixe `sm:`/`hover:`…) retire celle du bouton. Pas besoin de `!`.
 * Les classes inconnues de `classGroup` ne retirent rien ; la variante l'emporte de même sur la base.
 */
export function buttonClasses({ variant = "primary", className }: { variant?: ButtonVariant; className?: string } = {}): string {
  return mergeClasses(base, variants[variant], className);
}

/** Fusionne des listes de classes : chaque liste retire des précédentes les classes du même groupe. */
export function mergeClasses(...lists: (string | undefined)[]): string {
  let kept: string[] = [];
  for (const list of lists) {
    const classes = (list ?? "").split(/\s+/).filter(Boolean);
    const cleared = new Set(classes.flatMap(clearedKeys));
    kept = kept.filter((c) => {
      const key = ownKey(c);
      return key === null || !cleared.has(key);
    });
    kept.push(...classes);
  }
  return kept.join(" ");
}

// Côtés couverts par un raccourci de padding/marge (`px` couvre aussi `pl`, `pr`…).
const sides: Record<string, string[]> = {
  "": ["", "x", "y", "t", "r", "b", "l", "s", "e"],
  x: ["x", "l", "r", "s", "e"],
  y: ["y", "t", "b"],
};

/** Clé « préfixes | groupe » occupée par une classe (`sm:hover:|px`), `null` si groupe inconnu. */
function ownKey(cls: string): string | null {
  const { prefix, utility } = splitVariants(cls);
  const group = classGroup(utility);
  return group ? `${prefix}|${group}` : null;
}

/** Clés qu'une classe de l'appelant retire : la sienne, plus les côtés couverts par `p`/`px`/`py`/`m`… */
function clearedKeys(cls: string): string[] {
  const { prefix, utility } = splitVariants(cls);
  const group = classGroup(utility);
  if (!group) return [];
  const spacing = /^([pm])([xy]?)$/.exec(group);
  const groups = spacing ? (sides[spacing[2] ?? ""] ?? []).map((side) => `${spacing[1]}${side}`) : [group];
  return groups.map((g) => `${prefix}|${g}`);
}

/** Sépare `sm:hover:px-3!` en préfixe `sm:hover:` et utilitaire `px-3` (crochets respectés). */
function splitVariants(cls: string): { prefix: string; utility: string } {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) cut = i + 1;
  }
  const utility = cls.slice(cut).replace(/^!|!$/g, "").replace(/^-/, "");
  return { prefix: cls.slice(0, cut), utility };
}

const textSizes = /^text-(xs|sm|base|lg|[2-9]?xl|\[(\d|calc\(|length:))/;
const fontWeights = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const keywordGroups: Record<string, string> = {
  flex: "display", "inline-flex": "display", block: "display", "inline-block": "display", inline: "display",
  grid: "display", "inline-grid": "display", hidden: "display", contents: "display",
  underline: "decoration-line", "no-underline": "decoration-line", overline: "decoration-line", "line-through": "decoration-line",
  border: "border-width", rounded: "rounded", transition: "transition", shrink: "shrink", grow: "grow",
};

/**
 * Groupe de propriété d'un utilitaire Tailwind, ou `null` s'il n'est pas reconnu.
 * Couvre au moins toutes les classes de `base` et `variants` (vérifié par les tests).
 */
export function classGroup(utility: string): string | null {
  const keyword = keywordGroups[utility];
  if (keyword) return keyword;
  const spacing = /^([pm][xytrblse]?)-/.exec(utility);
  if (spacing?.[1]) return spacing[1];
  if (utility.startsWith("text-")) {
    if (/^text-(left|center|right|justify|start|end)$/.test(utility)) return "text-align";
    return textSizes.test(utility) ? "text-size" : "text-color";
  }
  if (utility.startsWith("font-")) return fontWeights.test(utility) ? "font-weight" : "font-family";
  if (utility.startsWith("border-")) {
    if (/^border-(\d+|\[\d)/.test(utility)) return "border-width";
    if (/^border-(solid|dashed|dotted|double|none|hidden)$/.test(utility)) return "border-style";
    if (/^border-[xytrblse](-|$)/.test(utility)) return null;
    return "border-color";
  }
  if (utility.startsWith("decoration-")) {
    if (/^decoration-(\d+|auto|from-font)$/.test(utility)) return "decoration-thickness";
    if (/^decoration-(solid|double|dotted|dashed|wavy)$/.test(utility)) return "decoration-style";
    return "decoration-color";
  }
  // Coins isolés (`rounded-t-lg`) : ne remplacent pas un `rounded-sm` global.
  if (/^rounded-[trblse]{1,2}(-|$)/.test(utility)) return null;
  const prefixed = /^(min-h|min-w|max-h|max-w|w|h|items|justify-items|justify-self|justify|gap-x|gap-y|gap|rounded|leading|underline-offset|transition|duration|ease|delay|bg|opacity|cursor|shrink|grow|basis|self)-/.exec(utility);
  return prefixed?.[1] ?? null;
}
