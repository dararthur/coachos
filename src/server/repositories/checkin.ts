import "server-only";
import type { Tx } from "@/server/db/client";

export interface CheckinState {
  status: "open" | "closed";
  windowEndsAt: Date | null;
  validatedAt: Date | null;
}

/** État du pointage d'une séance (lisible par le staff du club via la RLS). Absent = jamais ouvert. */
export async function getCheckinState(tx: Tx, academyId: string, sessionId: string): Promise<CheckinState> {
  const [row] = await tx<{ status: "open" | "closed"; windowEndsAt: Date | null; validatedAt: Date | null }[]>`
    select status, window_ends_at as "windowEndsAt", validated_at as "validatedAt"
    from public.session_checkins where session_id = ${sessionId} and academy_id = ${academyId}`;
  if (!row) return { status: "closed", windowEndsAt: null, validatedAt: null };
  // Une fenêtre échue est considérée fermée, même si le coach n'a rien fait.
  const expired = row.windowEndsAt !== null && row.windowEndsAt.getTime() <= Date.now();
  return { status: row.status === "open" && !expired ? "open" : "closed", windowEndsAt: row.windowEndsAt, validatedAt: row.validatedAt };
}

export async function openCheckin(tx: Tx, sessionId: string): Promise<void> {
  await tx`select public.checkin_open(${sessionId})`;
}

export async function closeCheckin(tx: Tx, sessionId: string): Promise<void> {
  await tx`select public.checkin_close(${sessionId})`;
}

export async function issueToken(tx: Tx, sessionId: string, tokenHash: string, ttlSeconds: number): Promise<Date> {
  const [row] = await tx<{ expires: Date }[]>`select public.checkin_issue_token(${sessionId}, ${tokenHash}, ${ttlSeconds}) as expires`;
  return row!.expires;
}

export async function setRollValidated(tx: Tx, sessionId: string, validated: boolean): Promise<void> {
  await tx`select public.roll_set_validated(${sessionId}, ${validated})`;
}

export interface CheckinPreview {
  className: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  alreadyRecorded: boolean;
  status: "present" | "late" | "absent" | null;
  /** Réservation du membre pour cette séance (obligatoire pour pointer). */
  booking: "booked" | "waitlisted" | null;
}

export async function peekCheckin(tx: Tx, tokenHash: string): Promise<CheckinPreview> {
  const [row] = await tx<{ r: { class_name: string; starts_at: string; ends_at: string; timezone: string; already_recorded: boolean; status: CheckinPreview["status"]; booking: CheckinPreview["booking"] } }[]>`
    select public.checkin_peek(${tokenHash}) as r`;
  const r = row!.r;
  return { className: r.class_name, startsAt: r.starts_at, endsAt: r.ends_at, timezone: r.timezone, alreadyRecorded: r.already_recorded, status: r.status, booking: r.booking };
}

export interface RedeemResult {
  /** « waitlisted » : séance pleine, le membre est en liste d'attente et n'est pas pointé. */
  result: "recorded" | "already" | "waitlisted";
  status: "present" | "late" | "absent" | null;
  className: string;
  startsAt: string;
}

type RedeemRow = { r: { result: RedeemResult["result"]; status?: RedeemResult["status"]; class_name: string; starts_at: string } };
const toRedeemResult = ({ r }: RedeemRow): RedeemResult => ({ result: r.result, status: r.status ?? null, className: r.class_name, startsAt: r.starts_at });

export async function redeemCheckin(tx: Tx, tokenHash: string): Promise<RedeemResult> {
  const [row] = await tx<RedeemRow[]>`select public.checkin_redeem(${tokenHash}) as r`;
  return toRedeemResult(row!);
}

/** Le membre n'avait pas réservé : réservation et pointage en un geste (liste d'attente si la séance est pleine). */
export async function bookAndRedeemCheckin(tx: Tx, tokenHash: string): Promise<RedeemResult> {
  const [row] = await tx<RedeemRow[]>`select public.checkin_book_and_redeem(${tokenHash}) as r`;
  return toRedeemResult(row!);
}

/** Horloge serveur (ms) : référence du compte à rebours côté client. */
export const serverNow = (): number => Date.now();

// --- QR fixe du club ---------------------------------------------------------------------------------
export interface FixedCandidate {
  sessionId: string;
  className: string;
  startsAt: string;
  endsAt: string;
  booking: "booked" | "waitlisted" | null;
  status: "present" | "late" | "absent" | null;
}

export interface FixedPeek {
  timezone: string;
  sessions: FixedCandidate[];
  /** Ouverture du pointage, en minutes avant le début du cours (réglage du club). */
  beforeMinutes: number;
  /** Prochain cours dont le pointage n'est pas encore ouvert. */
  next: { className: string; startsAt: string } | null;
}

/** Séances que ce QR fixe permet de pointer maintenant (réservées d'abord), et le prochain cours sinon. */
export async function peekFixedCheckin(tx: Tx, key: string): Promise<FixedPeek> {
  const [row] = await tx<
    { r: { timezone: string; before_minutes: number; next: { class_name: string; starts_at: string } | null; sessions: { session_id: string; class_name: string; starts_at: string; ends_at: string; booking: FixedCandidate["booking"]; status: FixedCandidate["status"] }[] } }[]
  >`select public.checkin_fixed_peek(${key}) as r`;
  const r = row!.r;
  return {
    timezone: r.timezone,
    beforeMinutes: r.before_minutes,
    next: r.next ? { className: r.next.class_name, startsAt: r.next.starts_at } : null,
    sessions: r.sessions.map((s) => ({ sessionId: s.session_id, className: s.class_name, startsAt: s.starts_at, endsAt: s.ends_at, booking: s.booking, status: s.status })),
  };
}

export async function redeemFixedCheckin(tx: Tx, key: string, sessionId: string, book: boolean): Promise<RedeemResult> {
  const [row] = await tx<RedeemRow[]>`select public.checkin_fixed_redeem(${key}, ${sessionId}, ${book}) as r`;
  return toRedeemResult(row!);
}

export interface CheckinSettings {
  mode: "rotating" | "fixed";
  beforeMinutes: number;
  afterMinutes: number;
  /** Clé du QR fixe (staff uniquement). */
  key: string | null;
}

export async function getCheckinSettings(tx: Tx, academyId: string): Promise<CheckinSettings> {
  const [row] = await tx<CheckinSettings[]>`
    select a.checkin_mode as mode, a.checkin_before_minutes as "beforeMinutes", a.checkin_after_minutes as "afterMinutes",
           (select k.key from public.academy_checkin_keys k where k.academy_id = a.id) as key
    from public.academies a where a.id = ${academyId}`;
  return row!;
}

export async function setCheckinSettings(tx: Tx, academyId: string, mode: string, before: number, after: number): Promise<void> {
  await tx`select public.set_checkin_settings(${academyId}, ${mode}, ${before}, ${after})`;
}

export async function regenerateCheckinKey(tx: Tx, academyId: string): Promise<void> {
  await tx`select public.regenerate_checkin_key(${academyId})`;
}
