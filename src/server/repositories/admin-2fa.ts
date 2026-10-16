import "server-only";
import { withApp } from "@/server/db/client";

/** Accès réservé au serveur (rôle app_server) : les fonctions refusent tout compte autre que l'administrateur désigné. */

/** Enregistre l'empreinte d'un nouveau code pour cette session (invalide tout code encore en attente de l'administrateur). */
export async function adminCodeIssue(userId: string, sessionId: string, hash: string, ttlSeconds: number): Promise<void> {
  await withApp((tx) => tx`select app_private.admin_code_issue(${userId}, ${sessionId}, ${hash}, ${ttlSeconds})`);
}

/** Échéance du code en attente pour cette session, ou null. */
export async function adminCodePending(userId: string, sessionId: string): Promise<Date | null> {
  const [row] = await withApp((tx) => tx<{ expires: Date | null }[]>`select app_private.admin_code_pending(${userId}, ${sessionId}) as expires`);
  return row?.expires ?? null;
}

/** Vrai une seule fois, pour le bon code de cette session, avant échéance et au plus 5 essais. */
export async function adminCodeCheck(userId: string, sessionId: string, hash: string): Promise<boolean> {
  const [row] = await withApp((tx) => tx<{ ok: boolean }[]>`select app_private.admin_code_check(${userId}, ${sessionId}, ${hash}) as ok`);
  return row?.ok === true;
}
