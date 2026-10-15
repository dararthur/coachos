import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/server/env";

/** Appels des tâches planifiées : `Authorization: Bearer $CRON_SECRET`. Sans secret configuré, les routes sont désactivées. */
export function cronAuthorized(request: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
