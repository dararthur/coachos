import { formatCalendarDate } from "@/domain/dates";
import { pauseReasonInfo } from "@/domain/lifecycle";

/**
 * Vignette de pause : emoji + libellé + date de reprise. RÉSERVÉE AU STAFF (feuille d'appel, liste et fiche des membres) et à la
 * personne elle-même : « blessure » et « malade » sont des données de santé (voir docs/rgpd/pauses-sante.md). Ne jamais l'afficher
 * sur un écran partagé (classement, tablette d'accueil) ni dans une notification.
 */
export function PauseBadge({ reason, until, compact = false }: { reason: string | null; until: string | null; compact?: boolean }) {
  const info = pauseReasonInfo(reason);
  if (!info || !until) return null;
  const text = `${info.label} jusqu'au ${formatCalendarDate(until)}`;
  return (
    <span
      title={text}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-sunken px-1.5 py-0.5 text-xs font-semibold text-ink"
    >
      <span aria-hidden="true">{info.emoji}</span>
      {compact ? <span className="sr-only">{text}</span> : <span>{text}</span>}
    </span>
  );
}
