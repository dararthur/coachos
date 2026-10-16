import { euros, isSubscriptionStatus, monthlyRevenueCents } from "./billing";
import { allClubAlerts, type AnyAlert } from "./club-alerts";
import { JOBS, JOB_IDS, METRIC_LABELS, jobHealth, sinceLabel, type JobRun, type Metric } from "./monitoring";

/**
 * Récapitulatif hebdomadaire des chiffres clés pour l'administrateur de la plateforme (e-mail du dimanche, 20 h).
 * Fonction pure : aucune donnée de membre, seulement des compteurs et des noms de clubs.
 */
export interface DigestClub {
  id: string;
  name: string;
  createdAt: Date;
  members: number;
  events7d: number;
  events30d: number;
  eventsPrev30d: number;
  lastEventAt: Date | null;
  planName: string | null;
  subscriptionStatus: string | null;
  renewsOn: string | null;
  priceCents: number | null;
  suspendedAt: Date | null;
}

export interface DigestInput {
  now: Date;
  /** « AAAA-MM-JJ » à Paris. */
  today: string;
  clubs: DigestClub[];
  pendingRequests: number;
  newClubs7d: number;
  newAccounts7d: number;
  jobs: JobRun[];
  counters7d: Partial<Record<Metric, number>>;
}

export interface DigestSection {
  title: string;
  lines: string[];
}

export interface Digest {
  subject: string;
  sections: DigestSection[];
  /** Nombre de points qui demandent un regard (clubs à surveiller, demandes, tâches, envois en échec). */
  flags: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(date);
}

export function buildDigest(input: DigestInput): Digest {
  const { now, today, clubs } = input;
  const live = clubs.filter((c) => !c.suspendedAt);
  const suspended = clubs.length - live.length;
  const members = live.reduce((s, c) => s + c.members, 0);
  const events7d = clubs.reduce((s, c) => s + c.events7d, 0);
  const events30d = clubs.reduce((s, c) => s + c.events30d, 0);
  const eventsPrev30d = clubs.reduce((s, c) => s + c.eventsPrev30d, 0);
  const active7d = clubs.filter((c) => c.events7d > 0).length;

  const sections: DigestSection[] = [];
  let flags = 0;

  const clubLines = [
    `${plural(clubs.length, "club")}${input.newClubs7d > 0 ? ` (+${input.newClubs7d} cette semaine)` : ""}, dont ${active7d} avec de l'usage cette semaine`,
    `${plural(members, "membre actif", "membres actifs")}${input.newAccounts7d > 0 ? `, ${plural(input.newAccounts7d, "nouveau compte", "nouveaux comptes")} cette semaine` : ""}`,
  ];
  if (suspended > 0) clubLines.push(`${plural(suspended, "club suspendu", "clubs suspendus")}`);
  sections.push({ title: "Clubs", lines: clubLines });

  const trend = eventsPrev30d >= 10 ? ` (${events30d >= eventsPrev30d ? "+" : "−"}${Math.abs(Math.round(((events30d - eventsPrev30d) / eventsPrev30d) * 100))} % sur 30 jours)` : "";
  sections.push({ title: "Usage", lines: [`${events7d} événements sur 7 jours, ${events30d} sur 30 jours${trend}`, "Pointages par QR, réservations et feuilles d'appel."] });

  const watched: { club: DigestClub; alerts: AnyAlert[] }[] = clubs
    .map((club) => ({ club, alerts: allClubAlerts(club, now, today) }))
    .filter((x) => x.alerts.length > 0)
    .sort((a, b) => Number(b.alerts.some((x) => x.level === "danger")) - Number(a.alerts.some((x) => x.level === "danger")));
  flags += watched.length;
  sections.push({
    title: "À surveiller",
    lines: watched.length === 0 ? ["Rien à signaler."] : watched.map(({ club, alerts }) => `${club.name} : ${alerts.map((a) => a.text).join(" ; ")}`),
  });

  const billing = clubs.map((c) => ({ subscriptionStatus: isSubscriptionStatus(c.subscriptionStatus) ? c.subscriptionStatus : null, priceCents: c.priceCents }));
  const overdue = clubs.filter((c) => c.subscriptionStatus === "overdue").length;
  const trials = clubs.filter((c) => c.subscriptionStatus === "trial").length;
  sections.push({
    title: "Facturation",
    lines: [`Revenu mensuel indicatif : ${euros(monthlyRevenueCents(billing))} (formules actives)`, `${plural(overdue, "paiement en retard", "paiements en retard")}, ${plural(trials, "essai en cours", "essais en cours")}`],
  });

  flags += input.pendingRequests > 0 ? 1 : 0;
  sections.push({
    title: "Demandes de club",
    lines: [input.pendingRequests > 0 ? `${plural(input.pendingRequests, "demande")} en attente de votre décision` : "Aucune demande en attente."],
  });

  const health: string[] = [];
  for (const id of JOB_IDS) {
    const run = input.jobs.find((j) => j.job === id) ?? null;
    const h = jobHealth(id, run, now);
    const state = { ok: "bon", late: "EN RETARD", failing: "EN ÉCHEC", never: "jamais exécutée" }[h.state];
    if (h.state === "late" || h.state === "failing") flags += 1;
    health.push(`${JOBS[id].label} : ${state}${h.minutesSinceRun !== null ? ` (dernier passage ${sinceLabel(h.minutesSinceRun)})` : ""}`);
  }
  const failed = (input.counters7d.mail_failed ?? 0) + (input.counters7d.push_failed ?? 0);
  if (failed > 0) flags += 1;
  health.push(
    `${METRIC_LABELS.mail_sent} : ${input.counters7d.mail_sent ?? 0} ; ${METRIC_LABELS.mail_failed.toLowerCase()} : ${input.counters7d.mail_failed ?? 0}`,
    `${METRIC_LABELS.push_sent} : ${input.counters7d.push_sent ?? 0} ; ${METRIC_LABELS.push_failed.toLowerCase()} : ${input.counters7d.push_failed ?? 0}`,
  );
  sections.push({ title: "Santé", lines: health });

  const subject = `Matnexa — chiffres clés du ${dayLabel(now)}${flags > 0 ? ` · ${plural(flags, "point")} à voir` : ""}`;
  return { subject, sections, flags };
}
