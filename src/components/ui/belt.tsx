import { ADULT_BELTS, BELT_LABELS, beltLabel, KIDS_BELTS, MAX_STRIPES, type Belt } from "@/domain/profile";

// Teintes des ceintures : sombres et saturées pour rester lisibles sur le fond blanc et le fond crème de Matnexa.
// La ceinture blanche reçoit un filet gris (sinon elle disparaît sur le blanc) ; la noire porte la barrette rouge réglementaire.
const BELT_STYLE: Record<Belt, { fill: string; edge: string; weave: string; bar: string; center?: string }> = {
  white: { fill: "#f7f5f0", edge: "#8a8378", weave: "#16191d", bar: "#16191d" },
  blue: { fill: "#1f56a8", edge: "#173f7d", weave: "#ffffff", bar: "#16191d" },
  purple: { fill: "#6d3fa8", edge: "#512d80", weave: "#ffffff", bar: "#16191d" },
  brown: { fill: "#6b4226", edge: "#4c2e1a", weave: "#ffffff", bar: "#16191d" },
  black: { fill: "#16191d", edge: "#16191d", weave: "#ffffff", bar: "#b42318" },
  // Ceintures enfants IBJJF : couleur pleine, avec une bande centrale blanche ou noire pour les degrés « et blanche » / « et noire ».
  grey: { fill: "#8d9299", edge: "#6a6f76", weave: "#ffffff", bar: "#16191d" },
  grey_white: { fill: "#8d9299", edge: "#6a6f76", weave: "#ffffff", bar: "#16191d", center: "#f7f5f0" },
  grey_black: { fill: "#8d9299", edge: "#6a6f76", weave: "#ffffff", bar: "#16191d", center: "#16191d" },
  yellow: { fill: "#e0ad12", edge: "#a97f00", weave: "#16191d", bar: "#16191d" },
  yellow_white: { fill: "#e0ad12", edge: "#a97f00", weave: "#16191d", bar: "#16191d", center: "#f7f5f0" },
  yellow_black: { fill: "#e0ad12", edge: "#a97f00", weave: "#16191d", bar: "#16191d", center: "#16191d" },
  orange: { fill: "#e0661a", edge: "#a84a0e", weave: "#ffffff", bar: "#16191d" },
  orange_white: { fill: "#e0661a", edge: "#a84a0e", weave: "#ffffff", bar: "#16191d", center: "#f7f5f0" },
  orange_black: { fill: "#e0661a", edge: "#a84a0e", weave: "#ffffff", bar: "#16191d", center: "#16191d" },
  green: { fill: "#2c8a3e", edge: "#1e6a2d", weave: "#ffffff", bar: "#16191d" },
  green_white: { fill: "#2c8a3e", edge: "#1e6a2d", weave: "#ffffff", bar: "#16191d", center: "#f7f5f0" },
  green_black: { fill: "#2c8a3e", edge: "#1e6a2d", weave: "#ffffff", bar: "#16191d", center: "#16191d" },
};

/** Options d'un sélecteur de ceinture : adultes puis enfants (IBJJF). */
export function BeltOptions() {
  return (
    <>
      <option value="">Non renseigné</option>
      <optgroup label="Adultes">
        {ADULT_BELTS.map((b) => (
          <option key={b} value={b}>
            {BELT_LABELS[b]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Enfants (IBJJF)">
        {KIDS_BELTS.map((b) => (
          <option key={b} value={b}>
            {BELT_LABELS[b]}
          </option>
        ))}
      </optgroup>
    </>
  );
}

const SIZES = { sm: "h-3.5", md: "h-[18px]", lg: "h-6" } as const;

/**
 * Ceinture de JJB dessinée à plat, vue de dessus : toile, deux coutures, barre de grade (noire, rouge pour la ceinture noire) et
 * jusqu'à 4 barrettes blanches. Texte alternatif complet (« Ceinture bleue, 2 barrettes ») ; `decorative` quand le libellé est déjà à côté.
 */
export function BeltIcon({ belt, stripes = 0, size = "md", decorative = false }: { belt: Belt; stripes?: number; size?: keyof typeof SIZES; decorative?: boolean }) {
  const s = BELT_STYLE[belt];
  const n = Math.max(0, Math.min(MAX_STRIPES, Math.trunc(stripes)));
  return (
    <svg
      viewBox="0 0 72 18"
      className={`${SIZES[size]} w-auto shrink-0`}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": beltLabel(belt, n) })}
      focusable="false"
    >
      <rect x="1" y="3" width="70" height="12" rx="2.5" fill={s.fill} stroke={s.edge} strokeWidth="1" />
      {s.center && <rect x="1" y="7.5" width="45" height="3" fill={s.center} />}
      <path d="M4 7.2H44M4 10.8H44" stroke={s.weave} strokeOpacity={belt === "white" ? 0.14 : 0.2} strokeWidth="0.8" />
      <rect x="46" y="3" width="16" height="12" fill={s.bar} />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={47.4 + i * 3.5} y="3" width="2" height="12" fill="#ffffff" />
      ))}
      <rect x="1" y="3" width="70" height="12" rx="2.5" fill="none" stroke={s.edge} strokeWidth="1" />
    </svg>
  );
}

/** Ceinture + libellé écrit (« Bleue · 2 barrettes »), pour les listes et les fiches. Sans grade : tiret discret. */
export function BeltLabel({ belt, stripes = 0, size = "md" }: { belt: Belt | null; stripes?: number; size?: keyof typeof SIZES }) {
  if (!belt) return <span className="text-sm text-ink-faint">Grade non renseigné</span>;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <BeltIcon belt={belt} stripes={stripes} size={size} decorative />
      <span>
        {BELT_LABELS[belt]}
        {stripes > 0 && <span className="text-ink-soft"> · {stripes} barrette{stripes > 1 ? "s" : ""}</span>}
      </span>
    </span>
  );
}
