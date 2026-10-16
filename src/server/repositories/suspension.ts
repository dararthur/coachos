import "server-only";
import type { Tx } from "@/server/db/client";

export interface ClubSuspension {
  suspendedAt: Date;
  reason: string | null;
}

/** Les clubs suspendus dont le compte est membre (nom seulement : le motif est interne à la plateforme). */
export async function mySuspendedClubs(tx: Tx): Promise<{ id: string; name: string }[]> {
  return tx<{ id: string; name: string }[]>`select id, name from public.my_suspended_academies()`;
}

/** Suspension d'un club. Console de l'administrateur de la plateforme (la fonction refuse tout autre compte). */
export async function clubSuspension(tx: Tx, academyId: string): Promise<ClubSuspension | null> {
  const [row] = await tx<ClubSuspension[]>`select suspended_at as "suspendedAt", reason from public.admin_club_suspension(${academyId})`;
  return row ?? null;
}

export async function setClubSuspension(tx: Tx, academyId: string, suspended: boolean, reason: string | null): Promise<void> {
  await tx`select public.admin_set_club_suspension(${academyId}, ${suspended}, ${reason})`;
}
