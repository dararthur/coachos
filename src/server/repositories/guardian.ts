import "server-only";
import type { Tx } from "@/server/db/client";

export interface ConsentPreview {
  childFirstName: string;
  academyName: string;
  state: "pending" | "already";
}

/** Lecture sans effet du lien d'accord (rôle app_server) : null si le lien est inconnu, expiré ou retiré. */
export async function previewConsent(tx: Tx, tokenHash: string): Promise<ConsentPreview | null> {
  const [row] = await tx<{ childFirstName: string; academyName: string; state: "pending" | "already" }[]>`
    select child_first_name as "childFirstName", academy_name as "academyName", state from app_private.preview_guardian_consent(${tokenHash})`;
  return row ?? null;
}

/** Confirme l'accord (rôle app_server) ; avec `userId`, rattache le compte comme responsable si la fiche n'en a pas encore. */
export async function confirmConsent(tx: Tx, tokenHash: string, userId: string | null): Promise<"confirmed" | "already" | "invalid"> {
  const [row] = await tx<{ state: "confirmed" | "already" | "invalid" }[]>`select state from app_private.confirm_guardian_consent(${tokenHash}, ${userId})`;
  return row?.state ?? "invalid";
}

export interface ChildRow {
  childId: string;
  academyId: string;
  academyName: string;
  firstName: string;
  lastName: string;
  rankingOptIn: boolean;
  consentConfirmedAt: Date | null;
  consentWithdrawnAt: Date | null;
  lastAttendedAt: Date | null;
  canHaveAccount: boolean;
  hasAccount: boolean;
}

export async function myChildren(tx: Tx): Promise<ChildRow[]> {
  const rows = await tx<ChildRow[]>`
    select child_id as "childId", academy_id as "academyId", academy_name as "academyName", first_name as "firstName", last_name as "lastName",
           ranking_opt_in as "rankingOptIn", consent_confirmed_at as "consentConfirmedAt",
           consent_withdrawn_at as "consentWithdrawnAt", last_attended_at as "lastAttendedAt",
           can_have_account as "canHaveAccount", has_account as "hasAccount"
    from public.my_children()`;
  return [...rows];
}

export async function setChildRanking(tx: Tx, childId: string, visible: boolean): Promise<void> {
  await tx`select public.set_child_ranking_visibility(${childId}, ${visible})`;
}

export async function inviteMinorAccount(tx: Tx, childId: string, email: string, tokenHash: string): Promise<void> {
  await tx`select public.invite_minor_account(${childId}, ${email}, ${tokenHash})`;
}

export async function withdrawChildConsent(tx: Tx, childId: string): Promise<void> {
  await tx`select public.withdraw_guardian_consent(${childId})`;
}
