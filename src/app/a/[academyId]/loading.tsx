import { TallyGlyph } from "@/components/ui/ui";

/** Chargement d'une page du club : le cadre (navigation) reste en place, seul le contenu attend. */
export default function Loading() {
  return (
    <div role="status" className="flex items-center gap-3 py-16 text-sm font-semibold text-ink-soft">
      <TallyGlyph />
      Chargement…
    </div>
  );
}
