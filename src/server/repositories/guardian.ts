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

export interface ChildSession {
  sessionId: string;
  className: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  timezone: string;
  booked: number;
  waitlisted: number;
  childStatus: "booked" | "waitlisted" | null;
  childPosition: number | null;
  deniedAudience: "adults" | "kids" | null;
}

export interface ChildRow {
  /** Prochains cours (14 jours), seulement pour un enfant dont l'accord est confirmé. */
  sessions?: ChildSession[];
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

/** Les enfants, avec leurs prochains cours quand l'accord est confirmé (un appel par enfant : ils sont peu nombreux). */
export async function myChildrenWithSessions(tx: Tx): Promise<ChildRow[]> {
  const rows = await myChildren(tx);
  for (const c of rows) {
    if (c.consentConfirmedAt && !c.consentWithdrawnAt) {
      c.sessions = [
        ...(await tx<ChildSession[]>`
          select session_id as "sessionId", class_name as "className", starts_at as "startsAt", ends_at as "endsAt", capacity, timezone,
                 booked, waitlisted, child_status as "childStatus", child_position as "childPosition", denied_audience as "deniedAudience"
          from public.child_sessions(${c.childId})`),
      ];
    }
  }
  return rows;
}

export async function bookForChild(tx: Tx, sessionId: string, childId: string): Promise<"booked" | "waitlisted"> {
  const [row] = await tx<{ s: "booked" | "waitlisted" }[]>`select public.book_for_child(${sessionId}, ${childId}) as s`;
  return row!.s;
}

export async function cancelChildBooking(tx: Tx, sessionId: string, childId: string): Promise<void> {
  await tx`select public.cancel_child_booking(${sessionId}, ${childId})`;
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
