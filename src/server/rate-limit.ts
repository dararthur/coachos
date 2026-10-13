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

export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

/** Fenêtre fixe, partagée entre instances (stockée en base). Échoue fermé en cas d'erreur. */
export async function enforceRateLimit(scope: string, raw: string, max: number, windowSeconds: number): Promise<void> {
  const key = limiterKey(scope, raw);
  const [row] = await withApp((tx) => tx<{ ok: boolean }[]>`select app_private.hit_rate_limit(${key}, ${max}, ${windowSeconds}) as ok`);
  if (!row?.ok) throw new AppError("rate_limited");
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
  writes: { max: 600, window: 60 }, // plafond générique par utilisateur
} as const;
