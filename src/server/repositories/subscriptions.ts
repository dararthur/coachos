import "server-only";
import type { SubscriptionStatus } from "@/domain/billing";
import type { Tx } from "@/server/db/client";

export interface ClubSubscription {
  planName: string;
  status: SubscriptionStatus;
  startsOn: string | null;
  renewsOn: string | null;
  priceCents: number | null;
  note: string | null;
}

/** Formule d'un club, ou null si aucune n'est enregistrée. Console de l'administrateur de la plateforme (la fonction refuse tout autre compte). */
export async function clubSubscription(tx: Tx, academyId: string): Promise<ClubSubscription | null> {
  const [row] = await tx<ClubSubscription[]>`
    select plan_name as "planName", status, starts_on::text as "startsOn", renews_on::text as "renewsOn", price_cents as "priceCents", note
    from public.admin_club_subscription(${academyId})`;
  return row ?? null;
}

export async function setClubSubscription(tx: Tx, academyId: string, s: ClubSubscription): Promise<void> {
  await tx`select public.admin_set_club_subscription(${academyId}, ${s.planName}, ${s.status}, ${s.startsOn}::date, ${s.renewsOn}::date, ${s.priceCents}::integer, ${s.note})`;
}
