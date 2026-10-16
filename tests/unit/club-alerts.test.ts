import { describe, expect, it } from "vitest";
import { clubAlerts, lastThirteenMonths, type ClubActivity } from "@/domain/club-alerts";

const now = new Date("2026-10-16T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const club = (over: Partial<ClubActivity> = {}): ClubActivity => ({ createdAt: daysAgo(90), events30d: 40, eventsPrev30d: 40, lastEventAt: daysAgo(1), ...over });

describe("clubs à surveiller", () => {
  it("un club actif et stable n'a aucune alerte", () => {
    expect(clubAlerts(club(), now)).toEqual([]);
  });

  it("un club de moins de 14 jours est en démarrage, même sans aucun usage", () => {
    expect(clubAlerts(club({ createdAt: daysAgo(13), lastEventAt: null, events30d: 0 }), now)).toEqual([]);
  });

  it("aucun usage depuis la création, au-delà de 14 jours", () => {
    const [a] = clubAlerts(club({ createdAt: daysAgo(14), lastEventAt: null, events30d: 0, eventsPrev30d: 0 }), now);
    expect(a).toMatchObject({ kind: "never", level: "danger" });
    expect(a!.text).toContain("14 jours");
  });

  it("silencieux depuis 14 jours ou plus", () => {
    expect(clubAlerts(club({ lastEventAt: daysAgo(13) }), now)).toEqual([]);
    const [a] = clubAlerts(club({ lastEventAt: daysAgo(20), events30d: 3 }), now);
    expect(a).toMatchObject({ kind: "silent", level: "danger", text: "Aucun usage depuis 20 jours" });
  });

  it("baisse de plus de moitié, seulement si le mois précédent avait assez d'usage", () => {
    const [a] = clubAlerts(club({ eventsPrev30d: 100, events30d: 30 }), now);
    expect(a).toMatchObject({ kind: "drop", level: "warning" });
    expect(a!.text).toContain("70 %");
    expect(clubAlerts(club({ eventsPrev30d: 100, events30d: 50 }), now)).toEqual([]); // exactement la moitié : pas d'alerte
    expect(clubAlerts(club({ eventsPrev30d: 9, events30d: 0, lastEventAt: daysAgo(2) }), now)).toEqual([]); // trop peu pour comparer
  });

  it("le silence prime sur la baisse (une seule alerte, la plus grave)", () => {
    expect(clubAlerts(club({ lastEventAt: daysAgo(30), eventsPrev30d: 100, events30d: 0 }), now).map((a) => a.kind)).toEqual(["silent"]);
  });
});

describe("série des 13 derniers mois", () => {
  it("complète les mois sans usage, additionne les types d'un même mois et finit sur le mois courant", () => {
    const points = lastThirteenMonths(
      [
        { month: "2026-10-01", n: 5 },
        { month: "2026-10-01", n: 7 },
        { month: "2026-08-01", n: 2 },
        { month: "2025-10-01", n: 4 },
      ],
      now,
    );
    expect(points).toHaveLength(13);
    expect(points[0]).toEqual({ month: "2025-10", total: 4 });
    expect(points[12]).toEqual({ month: "2026-10", total: 12 });
    expect(points.find((p) => p.month === "2026-09")!.total).toBe(0);
    expect(points.find((p) => p.month === "2026-08")!.total).toBe(2);
  });

  it("traverse un changement d'année", () => {
    const points = lastThirteenMonths([], new Date("2026-02-10T00:00:00Z"));
    expect(points[0]!.month).toBe("2025-02");
    expect(points[12]!.month).toBe("2026-02");
    expect(points.map((p) => p.month)).toContain("2025-12");
  });
});
