export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 no-underline";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-ink hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-brand-700 hover:bg-brand-50",
};

export function buttonClasses({ variant = "primary", className }: { variant?: ButtonVariant; className?: string } = {}): string {
  return [base, variants[variant], className].filter(Boolean).join(" ");
}
