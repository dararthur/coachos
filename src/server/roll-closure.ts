import "server-only";
import { withApp, type Sql } from "@/server/db/client";
import { logger } from "@/server/logger";

/**
 * Clôture automatique des feuilles d'appel (appelée toutes les heures par /api/cron/close-rolls). Toute la logique est dans la base
 * (migration 20261016000200) : mêmes règles que la validation manuelle, idempotente, fuseau du club.
 */
export async function closeDueRolls(deps: { sql?: Sql } = {}): Promise<{ closed: number; failed: number; noShows: number }> {
  const [row] = await withApp((tx) => tx<{ r: { closed: number; failed: number; no_shows: number } }[]>`select app_private.close_due_rolls() as r`, deps.sql);
  const result = { closed: row!.r.closed, failed: row!.r.failed, noShows: row!.r.no_shows };
  if (result.closed > 0 || result.failed > 0) logger.info("rolls.auto_closed", result);
  return result;
}
