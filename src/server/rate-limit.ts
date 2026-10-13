import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { AppError } from "@/domain/errors";
import { withApp } from "@/server/db/client";
import { env } from "@/server/env";

/** Clé pseudonymisée : on ne stocke ni adresse IP ni e-mail en clair dans les compteurs. */
export function limiterKey(scope: string, raw: string): string {
  const mac = createHmac("sha256", env().APP_SECRET).update(raw).digest("hex").slice(0, 32);
  return `${scope}:${mac}`;
}

/**
 * Adresse IP du client, telle que posée par le reverse proxy de confiance (Nginx ÉCRASE X-Real-IP : jamais fourni par le client).
 * Sans proxy qui écrase cet en-tête, la limite par IP est contournable : voir docs/self-hosted-auth.md.
 */
export async function clientIp(): Promise<string> {
  return headersClientIp(await headers());
}

export const CLIENT_IP_HEADER = "x-real-ip";

export function headersClientIp(h: Pick<Headers, "get">): string {
  return h.get(CLIENT_IP_HEADER)?.trim() || "unknown";
}

/** Pseudonyme HMAC (32 hex) : pour tout ce qui doit rester comparable sans stocker l'adresse (IP de session). */
export function pseudonym(raw: string): string {
  return createHmac("sha256", env().APP_SECRET).update(raw).digest("hex").slice(0, 32);
}

/** true si l'appel est autorisé. Échoue FERMÉ : une erreur de base remonte et la requête échoue. */
export async function hitRateLimit(scope: string, raw: string, max: number, windowSeconds: number): Promise<boolean> {
  const key = limiterKey(scope, raw);
  const [row] = await withApp((tx) => tx<{ ok: boolean }[]>`select app_private.hit_rate_limit(${key}, ${max}, ${windowSeconds}) as ok`);
  return row?.ok === true;
}

export async function enforceRateLimit(scope: string, raw: string, max: number, windowSeconds: number): Promise<void> {
  if (!(await hitRateLimit(scope, raw, max, windowSeconds))) throw new AppError("rate_limited");
}

/** Limites nommées, regroupées pour rester cohérentes et auditables. */
export const LIMITS = {
  login: { max: 10, window: 15 * 60 },
  signup: { max: 5, window: 60 * 60 },
  passwordReset: { max: 5, window: 60 * 60 },
  invitation: { max: 30, window: 60 * 60 },
  invitationAccept: { max: 10, window: 15 * 60 },
  importCsv: { max: 10, window: 60 * 60 },
  exportCsv: { max: 30, window: 60 * 60 },
  personalExport: { max: 20, window: 60 * 60 },
  erase: { max: 30, window: 60 * 60 },
  accountDelete: { max: 3, window: 60 * 60 },
  checkinIssue: { max: 400, window: 60 * 60 },
  checkinScan: { max: 40, window: 10 * 60 },
  writes: { max: 600, window: 60 }, // plafond générique par utilisateur
} as const;
