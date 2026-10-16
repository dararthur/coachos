import { describe, expect, it } from "vitest";
import { buildDigest, type DigestClub, type DigestInput } from "@/domain/digest";

// Dimanche 18 octobre 2026, 20 h à Paris.
const now = new Date("2026-10-18T18:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const club = (over: Partial<DigestClub> = {}): DigestClub => ({
  id: "c1",
  name: "Club Alpha",
  createdAt: daysAgo(90),
  members: 40,
  events7d: 25,
  events30d: 100,
  eventsPrev30d: 90,
  lastEventAt: daysAgo(1),
  planName: "Club",
  subscriptionStatus: "active",
  renewsOn: "2026-12-01",
  priceCents: 4900,
  suspendedAt: null,
  ...over,
});
const healthyJobs = (): DigestInput["jobs"] =>
  (["reminders", "close_rolls", "purge", "weekly_digest"] as const).map((job) => ({ job, lastRunAt: daysAgo(0), lastSuccessAt: daysAgo(0), lastFailureAt: null, lastError: null, successes: 5, failures: 0 }));
const input = (over: Partial<DigestInput> = {}): DigestInput => ({
  now,
  today: "2026-10-18",
  clubs: [club()],
  pendingRequests: 0,
  newClubs7d: 0,
  newAccounts7d: 0,
  jobs: healthyJobs(),
  counters7d: { mail_sent: 12, mail_failed: 0, push_sent: 30, push_failed: 0 },
  ...over,
});
const section = (d: ReturnType<typeof buildDigest>, title: string) => d.sections.find((s) => s.title === title)!.lines.join("\n");

describe("récapitulatif hebdomadaire", () => {
  it("semaine calme : aucun point à voir, objet daté, chiffres clés présents", () => {
    const d = buildDigest(input());
    expect(d.flags).toBe(0);
    expect(d.subject).toBe("Matnexa — chiffres clés du 18 octobre");
    expect(section(d, "Clubs")).toContain("1 club, dont 1 avec de l'usage cette semaine");
    expect(section(d, "Clubs")).toContain("40 membres actifs");
    expect(section(d, "Usage")).toContain("25 événements sur 7 jours, 100 sur 30 jours (+11 % sur 30 jours)");
    expect(section(d, "À surveiller")).toBe("Rien à signaler.");
    expect(section(d, "Facturation")).toContain("49 €");
    expect(section(d, "Demandes de club")).toBe("Aucune demande en attente.");
    expect(section(d, "Santé")).toContain("Rappels de séance : bon");
  });

  it("compte les points à voir et les nomme dans l'objet", () => {
    const d = buildDigest(
      input({
        clubs: [club(), club({ id: "c2", name: "Club Beta", events7d: 0, events30d: 0, eventsPrev30d: 0, lastEventAt: daysAgo(30), subscriptionStatus: "overdue" })],
        pendingRequests: 2,
        counters7d: { mail_sent: 12, mail_failed: 3 },
      }),
    );
    // Club Beta (1) + demandes (1) + envois en échec (1)
    expect(d.flags).toBe(3);
    expect(d.subject).toBe("Matnexa — chiffres clés du 18 octobre · 3 points à voir");
    expect(section(d, "À surveiller")).toContain("Club Beta : Aucun usage depuis 30 jours ; Paiement en retard");
    expect(section(d, "Demandes de club")).toBe("2 demandes en attente de votre décision");
    expect(section(d, "Facturation")).toContain("1 paiement en retard");
  });

  it("une tâche en retard ou en échec est signalée", () => {
    const jobs = healthyJobs().map((j) => (j.job === "purge" ? { ...j, lastRunAt: daysAgo(4), lastSuccessAt: daysAgo(4) } : j.job === "reminders" ? { ...j, lastFailureAt: daysAgo(0), lastSuccessAt: daysAgo(1) } : j));
    const d = buildDigest(input({ jobs }));
    expect(d.flags).toBe(2);
    expect(section(d, "Santé")).toContain("Purge de rétention et avis de place : EN RETARD");
    expect(section(d, "Santé")).toContain("Rappels de séance : EN ÉCHEC");
  });

  it("un club suspendu n'est ni compté dans les membres ni surveillé ; nouveaux clubs et comptes de la semaine", () => {
    const d = buildDigest(
      input({ clubs: [club(), club({ id: "c3", name: "Club Gamma", members: 100, suspendedAt: daysAgo(3), events7d: 0, events30d: 0, lastEventAt: daysAgo(40) })], newClubs7d: 1, newAccounts7d: 4 }),
    );
    expect(section(d, "Clubs")).toContain("2 clubs (+1 cette semaine)");
    expect(section(d, "Clubs")).toContain("40 membres actifs, 4 nouveaux comptes cette semaine");
    expect(section(d, "Clubs")).toContain("1 club suspendu");
    expect(section(d, "À surveiller")).toBe("Rien à signaler.");
  });

  it("tendance : baisse affichée avec le signe moins, et rien quand le mois précédent est trop petit pour comparer", () => {
    expect(section(buildDigest(input({ clubs: [club({ events30d: 45, eventsPrev30d: 90 })] })), "Usage")).toContain("(−50 % sur 30 jours)");
    expect(section(buildDigest(input({ clubs: [club({ events30d: 5, eventsPrev30d: 4 })] })), "Usage")).not.toContain("%");
  });

  it("aucune tâche jamais exécutée n'est comptée comme alerte (l'installation vient d'avoir lieu)", () => {
    const d = buildDigest(input({ jobs: [] }));
    expect(d.flags).toBe(0);
    expect(section(d, "Santé")).toContain("jamais exécutée");
  });
});
