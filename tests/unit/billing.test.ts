import { describe, expect, it } from "vitest";
import { billingAlerts, euros, monthlyRevenueCents, parseEuros, type ClubBilling } from "@/domain/billing";

const today = "2026-10-16";
const b = (over: Partial<ClubBilling> = {}): ClubBilling => ({ planName: "Club", subscriptionStatus: "active", renewsOn: "2026-12-01", priceCents: 4900, ...over });

describe("alertes de facturation", () => {
  it("aucune alerte pour un club à jour", () => {
    expect(billingAlerts(b(), today, 90)).toEqual([]);
  });

  it("paiement en retard : alerte grave, quelle que soit l'échéance", () => {
    expect(billingAlerts(b({ subscriptionStatus: "overdue" }), today, 90)).toEqual([{ kind: "overdue", level: "danger", text: "Paiement en retard" }]);
  });

  it("échéance dépassée, aujourd'hui, proche (14 jours) et lointaine", () => {
    expect(billingAlerts(b({ renewsOn: "2026-10-10" }), today, 90)[0]).toMatchObject({ kind: "expired", level: "danger", text: "Échéance dépassée depuis 6 jours" });
    expect(billingAlerts(b({ renewsOn: "2026-10-15" }), today, 90)[0]!.text).toBe("Échéance dépassée depuis 1 jour");
    expect(billingAlerts(b({ renewsOn: today }), today, 90)[0]).toMatchObject({ kind: "renewal_soon", text: "Échéance aujourd'hui" });
    expect(billingAlerts(b({ renewsOn: "2026-10-30" }), today, 90)[0]).toMatchObject({ kind: "renewal_soon", level: "warning", text: "Échéance dans 14 jours" });
    expect(billingAlerts(b({ renewsOn: "2026-10-31" }), today, 90)).toEqual([]);
  });

  it("un essai suit les mêmes règles d'échéance ; un club résilié n'alerte plus", () => {
    expect(billingAlerts(b({ subscriptionStatus: "trial", renewsOn: "2026-10-20" }), today, 5)[0]!.text).toBe("Échéance dans 4 jours");
    expect(billingAlerts(b({ subscriptionStatus: "cancelled", renewsOn: "2026-01-01" }), today, 400)).toEqual([]);
  });

  it("sans formule : signalé seulement après le démarrage (14 jours)", () => {
    const none = b({ planName: null, subscriptionStatus: null, renewsOn: null, priceCents: null });
    expect(billingAlerts(none, today, 13)).toEqual([]);
    expect(billingAlerts(none, today, 14)[0]).toMatchObject({ kind: "no_plan", level: "warning" });
  });

  it("l'échéance se compte en jours calendaires, sans dérive au changement d'heure", () => {
    expect(billingAlerts(b({ renewsOn: "2026-10-26" }), "2026-10-24", 90)[0]!.text).toBe("Échéance dans 2 jours");
    expect(billingAlerts(b({ renewsOn: "2026-11-02" }), "2026-10-31", 90)[0]!.text).toBe("Échéance dans 2 jours"); // fin d'heure d'été le 25 octobre
  });
});

describe("montants", () => {
  it("revenu mensuel : seuls les clubs actifs comptent", () => {
    expect(
      monthlyRevenueCents([
        { subscriptionStatus: "active", priceCents: 4900 },
        { subscriptionStatus: "active", priceCents: null },
        { subscriptionStatus: "trial", priceCents: 4900 },
        { subscriptionStatus: "overdue", priceCents: 4900 },
        { subscriptionStatus: null, priceCents: 1000 },
        { subscriptionStatus: "active", priceCents: 2990 },
      ]),
    ).toBe(7890);
  });

  it("affichage et saisie des euros", () => {
    expect(euros(4900).replace(/\s/g, " ")).toBe("49 €");
    expect(euros(2990).replace(/\s/g, " ")).toBe("29,90 €");
    expect(parseEuros("29,90")).toBe(2990);
    expect(parseEuros("29.9")).toBe(2990);
    expect(parseEuros(" 49 ")).toBe(4900);
    expect(parseEuros("")).toBeNull();
    expect(parseEuros("abc")).toBeUndefined();
    expect(parseEuros("-5")).toBeUndefined();
    expect(parseEuros("1.234")).toBeUndefined();
  });
});
