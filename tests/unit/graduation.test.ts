import { describe, expect, it } from "vitest";
import { addMonths, assessEligibility, ibjjfAge, type PromotionEntry } from "@/domain/graduation";
import type { Belt } from "@/domain/profile";

/** Règles IBJJF (General System of Graduation, juin 2026) : art. 2 âges minimums, art. 3 durées minimales. */
const e = (belt: Belt, promotedOn: string, confirmed = true, stripes = 0): PromotionEntry => ({ belt, stripes, promotedOn, confirmed });

describe("dates", () => {
  it("ajoute des mois sans déborder sur le mois suivant", () => {
    expect(addMonths("2024-08-31", 6)).toBe("2025-02-28");
    expect(addMonths("2026-01-15", 24)).toBe("2028-01-15");
    expect(addMonths("2026-03-31", 18)).toBe("2027-09-30");
  });
  it("l'âge IBJJF est l'année en cours moins l'année de naissance", () => {
    expect(ibjjfAge("2010-12-31", "2026-01-02")).toBe(16);
  });
});

describe("adultes : durée minimale à la ceinture", () => {
  it("bleue : 2 ans avant la violette", () => {
    const r = assessEligibility({ belt: "blue", birthDate: null, history: [e("blue", "2024-10-20")], today: "2026-10-16" });
    expect(r).toMatchObject({ next: "purple", status: "waiting", eligibleOn: "2026-10-20", minMonths: 24 });
    const later = assessEligibility({ belt: "blue", birthDate: null, history: [e("blue", "2024-10-20")], today: "2026-10-20" });
    expect(later.status).toBe("eligible");
  });

  it("violette : 1 an et demi ; marron : 1 an", () => {
    expect(assessEligibility({ belt: "purple", birthDate: null, history: [e("purple", "2025-01-10")], today: "2026-10-16" })).toMatchObject({ next: "brown", eligibleOn: "2026-07-10", status: "eligible" });
    expect(assessEligibility({ belt: "brown", birthDate: null, history: [e("brown", "2026-03-01")], today: "2026-10-16" })).toMatchObject({ next: "black", eligibleOn: "2027-03-01", status: "waiting" });
  });

  it("blanche vers bleue : aucun minimum de durée", () => {
    expect(assessEligibility({ belt: "white", birthDate: null, history: [e("white", "2026-01-01")], today: "2026-10-16" })).toMatchObject({ next: "blue", status: "no_minimum", eligibleOn: null });
  });

  it("les barrettes ne remettent pas le compteur à zéro : la durée court depuis la couleur", () => {
    const history = [e("blue", "2024-10-20"), e("blue", "2025-03-01", true, 1), e("blue", "2025-11-01", true, 2)];
    expect(assessEligibility({ belt: "blue", birthDate: null, history, today: "2026-10-16" })).toMatchObject({ since: "2024-10-20", eligibleOn: "2026-10-20" });
  });

  it("une date non confirmée par l'équipe ne sert pas au calcul", () => {
    const r = assessEligibility({ belt: "blue", birthDate: null, history: [e("blue", "2026-10-16", false)], today: "2026-10-16" });
    expect(r).toMatchObject({ status: "date_unknown", eligibleOn: null, since: "2026-10-16", sinceConfirmed: false });
  });

  it("sans historique : date inconnue pour une ceinture soumise à durée, aucun minimum pour la blanche", () => {
    expect(assessEligibility({ belt: "purple", birthDate: null, history: [], today: "2026-10-16" }).status).toBe("date_unknown");
    expect(assessEligibility({ belt: "white", birthDate: null, history: [], today: "2026-10-16" }).status).toBe("no_minimum");
  });

  it("ancienne ceinture enfant : 1 an à la bleue si grise, jaune ou orange ; aucune durée si verte", () => {
    const fromYellow = [e("yellow", "2021-01-01"), e("blue", "2025-10-20")];
    expect(assessEligibility({ belt: "blue", birthDate: null, history: fromYellow, today: "2026-10-16" })).toMatchObject({ minMonths: 12, eligibleOn: "2026-10-20" });
    const fromGreen = [e("green_black", "2024-01-01"), e("blue", "2026-03-01")];
    expect(assessEligibility({ belt: "blue", birthDate: null, history: fromGreen, today: "2026-10-16" })).toMatchObject({ minMonths: 0, status: "no_minimum" });
  });

  it("la ceinture noire n'a pas de suivante dans cet outil", () => {
    expect(assessEligibility({ belt: "black", birthDate: null, history: [e("black", "2010-01-01")], today: "2026-10-16" }).status).toBe("none");
    expect(assessEligibility({ belt: null, birthDate: null, history: [], today: "2026-10-16" }).status).toBe("none");
  });
});

describe("âge minimum", () => {
  it("marron à noire : l'âge de 19 ans n'est pas vérifiable pour un adulte, l'équipe en est avertie", () => {
    const r = assessEligibility({ belt: "brown", birthDate: null, history: [e("brown", "2025-01-01")], today: "2026-10-16" });
    expect(r.status).toBe("eligible");
    expect(r.notes.join(" ")).toMatch(/19 ans/);
  });

  it("un mineur de 17 ans à la ceinture marron : la noire attend l'année de ses 19 ans", () => {
    const r = assessEligibility({ belt: "brown", birthDate: "2009-06-01", history: [e("brown", "2025-01-01")], today: "2026-10-16" });
    expect(r).toMatchObject({ next: "black", ageDate: "2028-01-01", timeDate: "2026-01-01", eligibleOn: "2028-01-01", status: "waiting" });
  });

  it("l'éligibilité retient la date la plus tardive entre durée et âge", () => {
    const r = assessEligibility({ belt: "blue", birthDate: "2009-03-03", history: [e("blue", "2024-12-01")], today: "2026-10-16" });
    expect(r).toMatchObject({ next: "purple", timeDate: "2026-12-01", ageDate: "2025-01-01", eligibleOn: "2026-12-01" });
  });
});

describe("enfants", () => {
  it("aucune durée minimale ; seul l'âge d'accès au groupe suivant compte", () => {
    // Gris, 6 ans : le groupe jaune s'ouvre l'année des 7 ans.
    expect(assessEligibility({ belt: "grey", birthDate: "2020-05-05", history: [], today: "2026-10-16" })).toMatchObject({ next: "yellow", ageDate: "2027-01-01", status: "waiting" });
    // Gris, 9 ans : l'âge est atteint, rien ne retient.
    expect(assessEligibility({ belt: "grey_black", birthDate: "2017-05-05", history: [], today: "2026-10-16" })).toMatchObject({ next: "yellow", status: "no_minimum" });
  });

  it("une ceinture blanche d'enfant mène au groupe gris", () => {
    expect(assessEligibility({ belt: "white", birthDate: "2018-01-01", history: [], today: "2026-10-16" }).next).toBe("grey");
  });

  it("l'année des 16 ans, le passage aux ceintures adultes devient obligatoire", () => {
    const r = assessEligibility({ belt: "orange", birthDate: "2010-09-09", history: [], today: "2026-10-16" });
    expect(r).toMatchObject({ next: "blue", due: true, status: "eligible", eligibleOn: "2026-01-01" });
    const green = assessEligibility({ belt: "green", birthDate: "2010-09-09", history: [], today: "2026-10-16" });
    expect(green.notes.join(" ")).toMatch(/violette/);
  });

  it("à 14 ans, le vert attend l'année des 16 ans", () => {
    expect(assessEligibility({ belt: "green", birthDate: "2012-04-04", history: [], today: "2026-10-16" })).toMatchObject({ next: "blue", ageDate: "2028-01-01", due: false, status: "waiting" });
  });
});
