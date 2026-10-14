import { Badge } from "@/components/ui/ui";
import { ConfirmAction, InlineAction } from "@/components/ui/confirm";
import type { ButtonVariant } from "@/components/ui/button-classes";
import { bookSessionAction, cancelBookingAction } from "@/server/actions/bookings";
import type { BookingInfo } from "@/server/repositories/bookings";

/** « 12/20 inscrits · 3 en attente » (la capacité n'est jamais bloquante : le surplus est mis en attente). */
export function occupancyLabel(b: Pick<BookingInfo, "booked" | "waitlisted">, capacity: number | null): string {
  const base = capacity ? `${b.booked}/${capacity} inscrit${b.booked > 1 ? "s" : ""}` : b.booked === 0 ? "Aucun inscrit" : `${b.booked} inscrit${b.booked > 1 ? "s" : ""}`;
  return b.waitlisted > 0 ? `${base} · ${b.waitlisted} en attente` : base;
}

/** Séance complète : une nouvelle réservation part en liste d'attente. */
export const isFull = (b: Pick<BookingInfo, "booked">, capacity: number | null) => capacity !== null && b.booked >= capacity;

/** Rappel affiché sous une séance où l'adhérent attend une place : la promotion est automatique mais pas notifiée. */
export const WAITLIST_HINT = "Si une place se libère, elle vous revient automatiquement, sans notification : vérifiez avant le cours.";

/**
 * Réservation de l'adhérent : état + action. `bookable` = séance à venir ou en cours, non annulée.
 * `label` (« JJB — Tous niveaux, mer. 14 oct. 19:00 ») complète le nom accessible des boutons, identiques d'une ligne à l'autre.
 * `emphasis` : une seule action orange par écran ; les autres lignes réservent en secondaire.
 */
export function BookingControls({
  academyId,
  sessionId,
  label,
  booking,
  capacity,
  bookable,
  emphasis = "secondary",
}: {
  academyId: string;
  sessionId: string;
  label: string;
  booking: BookingInfo;
  capacity: number | null;
  bookable: boolean;
  emphasis?: Extract<ButtonVariant, "primary" | "secondary">;
}) {
  const { myStatus, myPosition, waitlisted } = booking;
  const full = isFull(booking, capacity);
  const cancel = cancelBookingAction.bind(null, academyId, sessionId);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {myStatus === "booked" && <Badge tone="success">Inscrit</Badge>}
      {myStatus === "waitlisted" && <Badge tone="warning">Liste d&apos;attente{myPosition ? ` · n°${myPosition}` : ""}</Badge>}
      {bookable && myStatus === null && (
        <InlineAction
          action={bookSessionAction.bind(null, academyId, sessionId)}
          label={
            <>
              {full ? "Rejoindre la liste d'attente" : "Réserver"}
              <span className="sr-only"> : {label}</span>
            </>
          }
          pendingLabel={full ? "Inscription…" : "Réservation…"}
          variant={emphasis}
        />
      )}
      {/* Quitter la liste fait perdre son rang ; libérer sa place quand d'autres attendent la leur cède : on confirme. */}
      {bookable && myStatus === "waitlisted" && (
        <ConfirmAction
          action={cancel}
          trigger={
            <>
              Quitter la liste<span className="sr-only"> d&apos;attente : {label}</span>
            </>
          }
          triggerVariant="quiet"
          title="Quitter la liste d'attente ?"
          description={
            <p>
              Vous perdrez votre rang{myPosition ? ` (n°${myPosition})` : ""} pour « {label} ». Si vous vous réinscrivez, vous repasserez en fin de liste.
            </p>
          }
          confirmLabel="Quitter la liste"
        />
      )}
      {bookable && myStatus === "booked" && waitlisted > 0 && (
        <ConfirmAction
          action={cancel}
          trigger={
            <>
              Annuler<span className="sr-only"> ma réservation : {label}</span>
            </>
          }
          triggerVariant="quiet"
          title="Libérer votre place ?"
          description={
            <p>
              {waitlisted > 1 ? `${waitlisted} personnes attendent` : "Une personne attend"} une place pour « {label} » : la vôtre ira au premier de la liste. Si vous vous réinscrivez, vous passerez après {waitlisted > 1 ? "elles" : "elle"}.
            </p>
          }
          confirmLabel="Libérer ma place"
        />
      )}
      {bookable && myStatus === "booked" && waitlisted === 0 && (
        <InlineAction
          action={cancel}
          label={
            <>
              Annuler<span className="sr-only"> ma réservation : {label}</span>
            </>
          }
          pendingLabel="Annulation…"
          variant="quiet"
        />
      )}
    </div>
  );
}
