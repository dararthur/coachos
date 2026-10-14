import { describe, expect, it } from "vitest";
import { ordinal, parseRankingPeriod, rankingRange } from "@/domain/ranking";

describe("classement : périodes", () => {
  it("semaine ISO, mois et année civils, y compris en fin d'année", () => {
    expect(rankingRange("semaine", "2026-10-14")).toEqual({ from: "2026-10-12", to: "2026-10-19" });
    expect(rankingRange("mois", "2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(rankingRange("mois", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(rankingRange("annee", "2026-10-14")).toEqual({ from: "2026-01-01", to: "2027-01-01" });
  });
  it("période inconnue => mois ; rangs en français", () => {
    expect(parseRankingPeriod("x")).toBe("mois");
    expect(parseRankingPeriod("annee")).toBe("annee");
    expect([1, 2, 11].map(ordinal)).toEqual(["1er", "2e", "11e"]);
  });
});
