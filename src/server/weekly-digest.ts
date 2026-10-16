import "server-only";
import { localDate } from "@/domain/dates";
import { buildDigest, type DigestClub } from "@/domain/digest";
import type { JobRun, Metric } from "@/domain/monitoring";
import { withApp, type Sql } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { weeklyDigestEmail } from "@/server/mail/templates";
import type { Mailer } from "@/server/mail/types";
import { recordJob } from "@/server/monitoring";

/** Délai en deçà duquel un second déclenchement est ignoré : le récapitulatif ne part qu'une fois par semaine, même si le minuteur se répète. */
const MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;

interface Extra {
  pending_requests: number;
  new_clubs_7d: number;
  new_accounts_7d: number;
  jobs: { job: string; last_run_at: string; last_success_at: string | null; last_failure_at: string | null }[];
  counters_7d: Partial<Record<Metric, number>>;
}

export interface DigestDeps {
  sql?: Sql;
  mailer?: Mailer;
  now?: Date;
  /** Adresse de l'administrateur (jamais lue de la base) : par défaut PLATFORM_ADMIN_EMAIL. */
  to?: string | null;
  siteUrl?: string;
}

export type DigestResult = { sent: true; flags: number } | { sent: false; reason: "no_recipient" | "already_sent" };

/**
 * Prépare et envoie le récapitulatif hebdomadaire des chiffres clés à l'administrateur de la plateforme. Appelé le dimanche à 20 h par
 * la tâche planifiée. `force` ignore la protection contre le double envoi (essai manuel). L'échec d'envoi est enregistré et relancé :
 * la route répond 500 et l'alerte systemd part.
 */
export async function sendWeeklyDigest(options: { force?: boolean } = {}, deps: DigestDeps = {}): Promise<DigestResult> {
  const now = deps.now ?? new Date();
  const to = deps.to === undefined ? (env().PLATFORM_ADMIN_EMAIL ?? null) : deps.to;
  if (!to) return { sent: false, reason: "no_recipient" };

  if (!options.force) {
    const [last] = await withApp((tx) => tx<{ at: Date | null }[]>`select app_private.job_last_success('weekly_digest') as at`, deps.sql);
    if (last?.at && now.getTime() - last.at.getTime() < MIN_INTERVAL_MS) return { sent: false, reason: "already_sent" };
  }

  const { clubs, extra } = await withApp(async (tx) => {
    const rows = await tx<
      { id: string; name: string; createdAt: Date; members: number; events7d: number; events30d: number; eventsPrev30d: number; lastEventAt: Date | null; planName: string | null; subscriptionStatus: string | null; renewsOn: string | null; priceCents: number | null; suspendedAt: Date | null }[]
    >`select id, name, created_at as "createdAt", members, events_7d as "events7d", events_30d as "events30d", events_prev_30d as "eventsPrev30d",
             last_event_at as "lastEventAt", plan_name as "planName", subscription_status as "subscriptionStatus", renews_on::text as "renewsOn",
             price_cents as "priceCents", suspended_at as "suspendedAt"
      from app_private.club_overview()`;
    const [row] = await tx<{ extra: Extra }[]>`select app_private.digest_extra() as extra`;
    return { clubs: rows as DigestClub[], extra: row!.extra };
  }, deps.sql);

  const jobs: JobRun[] = extra.jobs.map((j) => ({
    job: j.job,
    lastRunAt: new Date(j.last_run_at),
    lastSuccessAt: j.last_success_at ? new Date(j.last_success_at) : null,
    lastFailureAt: j.last_failure_at ? new Date(j.last_failure_at) : null,
    lastError: null,
    successes: 0,
    failures: 0,
  }));
  const digest = buildDigest({
    now,
    today: localDate(now, "Europe/Paris"),
    clubs,
    pendingRequests: Number(extra.pending_requests),
    newClubs7d: Number(extra.new_clubs_7d),
    newAccounts7d: Number(extra.new_accounts_7d),
    jobs,
    counters7d: Object.fromEntries(Object.entries(extra.counters_7d).map(([k, v]) => [k, Number(v)])),
  });

  try {
    await (deps.mailer ?? getMailer()).send(weeklyDigestEmail(to, digest, `${deps.siteUrl ?? env().SITE_URL}/admin`));
  } catch (error) {
    logger.warn("weekly_digest.mail_failed", { kind: "weekly_digest" });
    await recordJob("weekly_digest", false, "mail_failed", deps.sql);
    throw error;
  }
  await recordJob("weekly_digest", true, undefined, deps.sql);
  return { sent: true, flags: digest.flags };
}
