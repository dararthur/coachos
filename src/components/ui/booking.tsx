import { Badge } from "@/components/ui/ui";
import { InlineAction } from "@/components/ui/confirm";
import { bookSessionAction, cancelBookingAction } from "@/server/actions/bookings";
import type { BookingInfo } from "@/server/repositories/bookings";

/** « 12/20 inscrits · 3 en attente » (la capacité n'est jamais bloquante : le surplus est mis en attente). */
export function occupancyLabel(b: Pick<BookingInfo, "booked" | "waitlisted">, capacity: number | null): string {
  const base = capacity ? `${b.booked}/${capacity} inscrit${b.booked > 1 ? "s" : ""}` : `${b.booked} inscrit${b.booked > 1 ? "s" : ""}`;
  return b.waitlisted > 0 ? `${base} · ${b.waitlisted} en attente` : base;
}

/** Réservation de l'adhérent : état + bouton. `bookable` = séance à venir ou en cours, non annulée. */
export function BookingControls({ academyId, sessionId, myStatus, myPosition, bookable }: { academyId: string; sessionId: string; myStatus: BookingInfo["myStatus"]; myPosition: number | null; bookable: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {myStatus === "booked" && <Badge tone="success">Inscrit</Badge>}
      {myStatus === "waitlisted" && <Badge tone="warning">Liste d&apos;attente{myPosition ? ` · n°${myPosition}` : ""}</Badge>}
      {bookable && myStatus === null && <InlineAction action={bookSessionAction.bind(null, academyId, sessionId)} label="Réserver" pendingLabel="Réservation…" variant="primary" />}
      {bookable && myStatus !== null && <InlineAction action={cancelBookingAction.bind(null, academyId, sessionId)} label="Annuler" pendingLabel="Annulation…" variant="quiet" />}
    </div>
  );
}
