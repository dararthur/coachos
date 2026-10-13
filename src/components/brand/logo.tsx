/**
 * Marque Matnexa. Le symbole est une barrette de ceinture : quatre bandes de ruban blanc sur la bande noire,
 * barrées d'un trait orange (le bâton de comptage des présences). Source vectorielle unique : public/icons/icon.svg.
 */
export function MatnexaMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#16191d" />
      <g fill="#ffffff">
        <rect x="7.25" y="8" width="2.5" height="16" rx="0.5" />
        <rect x="12.25" y="8" width="2.5" height="16" rx="0.5" />
        <rect x="17.25" y="8" width="2.5" height="16" rx="0.5" />
        <rect x="22.25" y="8" width="2.5" height="16" rx="0.5" />
      </g>
      <path d="M5 22.5 27 9.5" stroke="#16191d" strokeWidth="6.5" />
      <path d="M5 22.5 27 9.5" stroke="#ea6a2a" strokeWidth="3" />
    </svg>
  );
}

/** Logotype : symbole + nom. Le nom reste du texte (lisible, traduisible par les lecteurs d'écran). */
export function MatnexaLogo({ size = "md", tone = "ink", className }: { size?: "sm" | "md" | "lg"; tone?: "ink" | "light"; className?: string }) {
  const mark = size === "lg" ? 40 : size === "sm" ? 24 : 28;
  const text = size === "lg" ? "text-[1.75rem] leading-none" : size === "sm" ? "text-lg leading-none" : "text-[1.3125rem] leading-none";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <MatnexaMark size={mark} className={tone === "light" ? "rounded-[7px] ring-1 ring-white/15" : undefined} />
      <span className={`font-bold font-stretch-[87.5%] tracking-[-0.015em] ${text} ${tone === "light" ? "text-bar-text" : "text-ink"}`}>Matnexa</span>
    </span>
  );
}
