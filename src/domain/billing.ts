/**
 * Formule et facturation d'un club, tenues à la main par l'administrateur de la plateforme (le paiement lui-même est hors application).
 * Donnée interne : jamais montrée au club.
 */
export const SUBSCRIPTION_STATUSES = {
  trial: "Essai",
  active: "Actif",
  overdue: "En retard de paiement",
  cancelled: "Résilié",
} as const;

export type SubscriptionStatus = keyof typeof SUBSCRIPTION_STATUSES;
export const SUBSCRIPTION_STATUS_IDS = Object.keys(SUBSCRIPTION_STATUSES) as SubscriptionStatus[];

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && Object.hasOwn(SUBSCRIPTION_STATUSES, value);
}

export interface ClubBilling {
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  /** « AAAA-MM-JJ » */
  renewsOn: string | null;
  priceCents: number | null;
}

export interface BillingAlert {
  kind: "overdue" | "expired" | "renewal_soon" | "no_plan";
  level: "danger" | "warning";
  text: string;
}

/** Jours à l'avance pour lesquels une échéance proche est signalée. */
export const RENEWAL_WARNING_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * Alertes de facturation. `today` : date du jour « AAAA-MM-JJ ». Un club résilié ne génère plus d'alerte ; un club sans formule
 * enregistrée est signalé seulement une fois le démarrage passé (`ageDays` ≥ 14), pour ne pas bruiter un club tout neuf.
 */
export function billingAlerts(b: ClubBilling, today: string, ageDays: number): BillingAlert[] {
  if (!b.subscriptionStatus) {
    return ageDays >= 14 ? [{ kind: "no_plan", level: "warning", text: "Aucune formule enregistrée" }] : [];
  }
  if (b.subscriptionStatus === "cancelled") return [];
  if (b.subscriptionStatus === "overdue") return [{ kind: "overdue", level: "danger", text: "Paiement en retard" }];
  if (b.renewsOn) {
    const left = daysBetween(today, b.renewsOn);
    if (left < 0) return [{ kind: "expired", level: "danger", text: `Échéance dépassée depuis ${-left} jour${-left > 1 ? "s" : ""}` }];
    if (left <= RENEWAL_WARNING_DAYS) {
      return [{ kind: "renewal_soon", level: "warning", text: left === 0 ? "Échéance aujourd'hui" : `Échéance dans ${left} jour${left > 1 ? "s" : ""}` }];
    }
  }
  return [];
}

/** Revenu mensuel indicatif : somme des prix des clubs « actifs » (les essais, retards et résiliations ne comptent pas). */
export function monthlyRevenueCents(clubs: Pick<ClubBilling, "subscriptionStatus" | "priceCents">[]): number {
  return clubs.reduce((sum, c) => sum + (c.subscriptionStatus === "active" ? (c.priceCents ?? 0) : 0), 0);
}

export function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

/** Saisie « 29,90 » ou « 29.9 » en euros -> centimes ; null si vide ; NaN-safe (renvoie undefined si invalide). */
export function parseEuros(input: string): number | null | undefined {
  const t = input.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}
