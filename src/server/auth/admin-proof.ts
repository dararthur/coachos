import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/server/env";
import type { SessionUser } from "./session";

/**
 * Preuve de seconde authentification de l'administrateur : un cookie signé, lié à CE compte et à CETTE session.
 * Révoquer la session (déconnexion, mot de passe changé ou réinitialisé, « déconnecter les autres appareils ») invalide donc la preuve.
 * HttpOnly, SameSite=Strict, durée courte : l'administrateur ressaisit un code après 8 h ou sur un nouvel appareil.
 */
const MAX_AGE_SECONDS = 8 * 60 * 60;

function cookieName(): string {
  // Le préfixe __Host- impose Secure, Path=/ et aucun Domain : le navigateur refuse tout autre réglage.
  return env().SITE_URL.startsWith("https://") ? "__Host-mx_admin_2fa" : "mx_admin_2fa";
}

function sign(userId: string, sessionId: string, exp: number): string {
  return createHmac("sha256", env().APP_SECRET).update(`admin-2fa|${userId}|${sessionId}|${exp}`).digest("hex");
}

export async function issueAdminProof(user: SessionUser): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  (await cookies()).set(cookieName(), `${exp}.${sign(user.id, user.sessionId, exp)}`, {
    httpOnly: true,
    secure: env().SITE_URL.startsWith("https://"),
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearAdminProof(): Promise<void> {
  (await cookies()).delete(cookieName());
}

export async function hasAdminProof(user: SessionUser): Promise<boolean> {
  const raw = (await cookies()).get(cookieName())?.value;
  if (!raw) return false;
  const [expText, mac] = raw.split(".");
  const exp = Number(expText);
  if (!mac || !Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(user.id, user.sessionId, exp);
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
