import "server-only";
import type { Tx } from "@/server/db/client";
import type { SessionRow } from "./schedule";

export type BookingStatus = "booked" | "waitlisted";

export interface BookingInfo {
  booked: number;
  waitlisted: number;
  myStatus: BookingStatus | null;
  /** Rang dans la liste d'attente (1 = prochain à obtenir une place), null hors liste. */
  myPosition: number | null;
  /** Public du cours quand il n'est pas ouvert à l'appelant (« adults » ou « kids »), sinon null. */
  deniedAudience?: "adults" | "kids" | null;
}

export type BookableSession = SessionRow & BookingInfo;

const EMPTY: BookingInfo = { booked: 0, waitlisted: 0, myStatus: null, myPosition: null };

/** Ajoute l'occupation de chaque séance (visible de tout membre du club) et la réservation de l'appelant. */
export async function attachBookings(tx: Tx, academyId: string, sessions: SessionRow[]): Promise<BookableSession[]> {
  if (sessions.length === 0) return [];
  const times = sessions.map((s) => s.startsAt.getTime());
  const from = new Date(Math.min(...times));
  const to = new Date(Math.max(...times) + 1);
  const rows = await tx<{ sessionId: string; booked: number; waitlisted: number; myStatus: BookingStatus | null; myPosition: number | null; deniedAudience: "adults" | "kids" | null }[]>`
    select session_id as "sessionId", booked, waitlisted, my_status as "myStatus", my_position as "myPosition", denied_audience as "deniedAudience"
    from public.session_bookings_overview(${academyId}, ${from}, ${to})`;
  const byId = new Map(rows.map((r) => [r.sessionId, r]));
  return sessions.map((s) => ({ ...s, ...(byId.get(s.id) ?? EMPTY) }));
}

export async function bookSession(tx: Tx, sessionId: string): Promise<BookingStatus> {
  const [row] = await tx<{ s: BookingStatus }[]>`select public.book_session(${sessionId}) as s`;
  return row!.s;
}

export async function cancelBooking(tx: Tx, sessionId: string): Promise<void> {
  await tx`select public.cancel_booking(${sessionId})`;
}

export async function promoteBooking(tx: Tx, sessionId: string, personId: string): Promise<void> {
  await tx`select public.promote_booking(${sessionId}, ${personId})`;
}
