/**
 * Clubs à surveiller, calculés à partir des compteurs d'usage (aucune donnée de membre).
 * Un club de moins de 14 jours est « en démarrage » : on ne l'alerte pas encore.
 */
import { billingAlerts, isSubscriptionStatus, type BillingAlert, type ClubBilling } from "./billing";

export interface ClubActivity {
  createdAt: Date;
  events30d: number;
  eventsPrev30d: number;
  lastEventAt: Date | null;
}

export type AlertKind = "never" | "silent" | "drop";
export interface ClubAlert {
  kind: AlertKind;
  level: "danger" | "warning";
  text: string;
}

const DAY = 24 * 60 * 60 * 1000;
export const GRACE_DAYS = 14;
const SILENT_DAYS = 14;
/** Une baisse n'est signalée que si le mois précédent avait assez d'usage pour que la comparaison ait un sens. */
const DROP_MIN_PREVIOUS = 10;
const DROP_RATIO = 0.5;

export function clubAlerts(c: ClubActivity, now: Date): ClubAlert[] {
  const age = Math.floor((now.getTime() - c.createdAt.getTime()) / DAY);
  if (age < GRACE_DAYS) return [];
  if (!c.lastEventAt) return [{ kind: "never", level: "danger", text: `Aucun usage enregistré depuis la création (${age} jours)` }];
  const idle = Math.floor((now.getTime() - c.lastEventAt.getTime()) / DAY);
  if (idle >= SILENT_DAYS) return [{ kind: "silent", level: "danger", text: `Aucun usage depuis ${idle} jours` }];
  if (c.eventsPrev30d >= DROP_MIN_PREVIOUS && c.events30d < c.eventsPrev30d * DROP_RATIO) {
    const pct = Math.round((1 - c.events30d / c.eventsPrev30d) * 100);
    return [{ kind: "drop", level: "warning", text: `Usage en baisse de ${pct} % sur 30 jours (${c.eventsPrev30d} puis ${c.events30d})` }];
  }
  return [];
}

export interface MonthPoint {
  /** « 2026-10 » */
  month: string;
  total: number;
}

/** Complète les 13 derniers mois (les mois sans usage valent 0) pour que la courbe ait toujours la même largeur. */
export function lastThirteenMonths(rows: { month: string; n: number }[], now: Date): MonthPoint[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const key = r.month.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.n);
  }
  const out: MonthPoint[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ month: key, total: byMonth.get(key) ?? 0 });
  }
  return out;
}

export type AnyAlert = ClubAlert | BillingAlert;

/** Tout ce qui demande l'attention de l'administrateur pour un club : usage d'abord, puis facturation. */
export function allClubAlerts(
  c: ClubActivity & { planName: string | null; subscriptionStatus: string | null; renewsOn: string | null; priceCents: number | null; suspendedAt?: Date | null },
  now: Date,
  today: string,
): AnyAlert[] {
  if (c.suspendedAt) return []; // suspendu : plus d'usage par construction, rien à surveiller
  const billing: ClubBilling = {
    planName: c.planName,
    subscriptionStatus: isSubscriptionStatus(c.subscriptionStatus) ? c.subscriptionStatus : null,
    renewsOn: c.renewsOn,
    priceCents: c.priceCents,
  };
  const ageDays = Math.floor((now.getTime() - c.createdAt.getTime()) / DAY);
  return [...clubAlerts(c, now), ...billingAlerts(billing, today, ageDays)];
}

/** Libellé court de l'étiquette d'une alerte. */
export const ALERT_BADGES: Record<AnyAlert["kind"], string> = {
  never: "Inactif",
  silent: "Inactif",
  drop: "En baisse",
  overdue: "Paiement",
  expired: "Échéance",
  renewal_soon: "Échéance",
  no_plan: "Formule",
};
