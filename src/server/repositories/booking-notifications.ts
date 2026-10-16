import "server-only";
import type { Tx } from "@/server/db/client";

/** Promotion depuis la liste d'attente à annoncer par e-mail : le strict nécessaire au message, lu au moment de l'envoi. */
export interface PendingPromotion {
  id: string;
  /** « promoted » : place attribuée depuis la liste d'attente ; « cancelled » : la séance réservée est annulée. */
  kind: "promoted" | "cancelled";
  userId: string;
  academyId: string;
  email: string;
  academyName: string;
  className: string;
  startsAt: Date;
  timezone: string;
}

/**
 * Réserve un lot de notifications à envoyer (rôle `app_server`, via `withApp`). Supprime au passage celles qui ne doivent plus
 * partir (réservation annulée, séance commencée, fiche sans compte…). Une ligne réservée n'est reprise qu'après 10 minutes.
 */
export async function claimPromotions(tx: Tx, limit: number): Promise<PendingPromotion[]> {
  return tx<PendingPromotion[]>`
    select notification_id as id, kind, user_id as "userId", academy_id as "academyId", email, academy_name as "academyName",
           class_name as "className", starts_at as "startsAt", timezone
    from app_private.claim_booking_notifications(${limit})`;
}

/** E-mail remis au fournisseur : la notification est supprimée. */
export async function completePromotion(tx: Tx, id: string): Promise<void> {
  await tx`select app_private.complete_booking_notification(${id})`;
}

export interface DevicePushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Appareils abonnés d'un adhérent pour un club dont il est membre (lus à l'envoi, jamais copiés dans la file). */
export async function pushTargetsFor(tx: Tx, userId: string, academyId: string): Promise<DevicePushTarget[]> {
  return tx<DevicePushTarget[]>`select id, endpoint, p256dh, auth from app_private.push_targets_for_user(${userId}, ${academyId})`;
}
