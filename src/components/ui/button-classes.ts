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
  quiet: "px-3 text-ink underline decoration-ink/40 underline-offset-[3px] hover:decoration-ink",
};

export function buttonClasses({ variant = "primary", className }: { variant?: ButtonVariant; className?: string } = {}): string {
  return [base, variants[variant], className].filter(Boolean).join(" ");
}
