"use server";

import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { CHECKIN_TOKEN_TTL_SECONDS, checkinPath, isCheckinToken } from "@/domain/checkin";
import { uuidField } from "@/domain/validation";
import { authorizeAcademy, authorizeUser, inAcademy, runAction } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import * as attendance from "@/server/repositories/attendance";
import * as checkin from "@/server/repositories/checkin";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { hashToken } from "./helpers";

export interface CheckinStateDto {
  status: "open" | "closed";
  windowEndsAt: number | null;
  validatedAt: number | null;
}

export interface RollSnapshot {
  entries: Awaited<ReturnType<typeof attendance.getRoster>>;
  checkin: CheckinStateDto;
  /** Horloge serveur (ms) : le client calcule son décalage pour un compte à rebours exact. */
  serverNow: number;
}

const toDto = (s: checkin.CheckinState): CheckinStateDto => ({
  status: s.status,
  windowEndsAt: s.windowEndsAt?.getTime() ?? null,
  validatedAt: s.validatedAt?.getTime() ?? null,
});

const sessionIdOf = (sessionId: string) => {
  const parsed = uuidField.safeParse(sessionId);
  if (!parsed.success) throw new AppError("not_found");
  return parsed.data;
};

async function snapshot(ctx: Awaited<ReturnType<typeof authorizeAcademy>>, academyId: string, sessionId: string): Promise<RollSnapshot> {
  return inAcademy(ctx, async (tx) => ({
    entries: await attendance.getRoster(tx, academyId, sessionId),
    checkin: toDto(await checkin.getCheckinState(tx, academyId, sessionId)),
    serverNow: Date.now(),
  }));
}

/** Instantané fiable de la feuille d'appel (source de vérité = base) pour l'actualisation du coach. */
export async function getRollSnapshotAction(academyId: string, sessionId: string): Promise<ActionResult<RollSnapshot>> {
  return runAction("rollSnapshot", async () => {
    const ctx = await authorizeAcademy(academyId, "attendance.record");
    return { ok: true, data: await snapshot(ctx, academyId, sessionIdOf(sessionId)) };
  });
}

async function control(name: string, academyId: string, sessionId: string, op: (tx: Parameters<Parameters<typeof inAcademy>[1]>[0], id: string) => Promise<void>, message: string): Promise<ActionResult<RollSnapshot>> {
  return runAction(name, async () => {
    const ctx = await authorizeAcademy(academyId, "attendance.record");
    const id = sessionIdOf(sessionId);
    await inAcademy(ctx, (tx) => op(tx, id));
    return { ok: true, data: await snapshot(ctx, academyId, id), message };
  });
}

export async function openCheckinAction(academyId: string, sessionId: string): Promise<ActionResult<RollSnapshot>> {
  return control("checkin.open", academyId, sessionId, (tx, id) => checkin.openCheckin(tx, id), "Pointage ouvert.");
}

export async function closeCheckinAction(academyId: string, sessionId: string): Promise<ActionResult<RollSnapshot>> {
  return control("checkin.close", academyId, sessionId, (tx, id) => checkin.closeCheckin(tx, id), "Pointage fermé.");
}

export async function validateRollAction(academyId: string, sessionId: string, validated: boolean): Promise<ActionResult<RollSnapshot>> {
  return control("roll.validate", academyId, sessionId, (tx, id) => checkin.setRollValidated(tx, id, validated), validated ? "Feuille d'appel validée." : "Feuille d'appel rouverte.");
}

export interface IssuedToken {
  url: string;
  /** Image SVG du QR (data URI) : affichée dans un <img>, jamais injectée comme HTML. */
  qr: string;
  expiresAt: number;
  serverNow: number;
}

/** Émet un nouveau jeton court et renvoie le QR correspondant. Le jeton en clair n'est jamais stocké ni journalisé. */
export async function issueCheckinTokenAction(academyId: string, sessionId: string): Promise<ActionResult<IssuedToken>> {
  return runAction("checkin.issue", async () => {
    const ctx = await authorizeAcademy(academyId, "attendance.record");
    await enforceRateLimit("checkin-issue", ctx.user.id, LIMITS.checkinIssue.max, LIMITS.checkinIssue.window);
    const id = sessionIdOf(sessionId);
    const token = randomBytes(32).toString("base64url");
    const ttl = env().CHECKIN_TOKEN_TTL_SECONDS ?? CHECKIN_TOKEN_TTL_SECONDS;
    const expires = await inAcademy(ctx, (tx) => checkin.issueToken(tx, id, hashToken(token), ttl));
    const url = `${env().SITE_URL}${checkinPath(token)}`;
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
    return { ok: true, data: { url, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, expiresAt: expires.getTime(), serverNow: Date.now() } };
  });
}

// --- Adhérent -----------------------------------------------------------------------------------
const tokenSchema = z.string().refine(isCheckinToken);

async function memberCall<T>(name: string, token: string, run: (hash: string, user: Awaited<ReturnType<typeof authorizeUser>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(name, async () => {
    const user = await authorizeUser();
    await enforceRateLimit("checkin-scan", user.id, LIMITS.checkinScan.max, LIMITS.checkinScan.window);
    // Format invalide : même réponse qu'un jeton inconnu ou expiré.
    if (!tokenSchema.safeParse(token).success) return failure("checkin_invalid");
    return { ok: true, data: await run(hashToken(token), user) };
  });
}

export async function peekCheckinAction(token: string): Promise<ActionResult<checkin.CheckinPreview>> {
  return memberCall("checkin.peek", token, (hash, user) => withUser(user, (tx) => checkin.peekCheckin(tx, hash)));
}

/** Enregistre la présence de l'utilisateur connecté (identité = session). Succès renvoyé uniquement après l'écriture en base. */
export async function redeemCheckinAction(token: string): Promise<ActionResult<checkin.RedeemResult>> {
  return memberCall("checkin.redeem", token, (hash, user) => withUser(user, (tx) => checkin.redeemCheckin(tx, hash)));
}

/** Réserve la séance puis pointe, pour un adhérent qui n'avait pas réservé (identité = session). */
export async function bookAndRedeemCheckinAction(token: string): Promise<ActionResult<checkin.RedeemResult>> {
  return memberCall("checkin.bookAndRedeem", token, (hash, user) => withUser(user, (tx) => checkin.bookAndRedeemCheckin(tx, hash)));
}
