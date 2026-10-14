import { describe, expect, it } from "vitest";
import { assiduityLabel, checkinProgress, myRank, weeksAttended } from "@/domain/assiduity";

const TZ = "Europe/Paris";
// Mercredi 14 octobre 2026, 19:30 à Paris.
const NOW = new Date("2026-10-14T17:30:00Z");
const at = (iso: string, status = "present") => ({ startsAt: new Date(iso), status });

describe("assiduité et progression après un pointage", () => {
  it("8 semaines, la plus ancienne d'abord ; une absence ne compte pas", () => {
    const weeks = weeksAttended([at("2026-10-14T17:00:00Z"), at("2026-10-06T17:00:00Z", "absent"), at("2026-08-24T17:00:00Z", "late")], TZ, NOW);
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)).toBe(true); // semaine en cours
    expect(weeks.at(-2)).toBe(false); // seulement une absence
    expect(weeks[0]).toBe(true); // semaine du 24 août, en retard = venue
    expect(assiduityLabel(weeks)).toBe("2 semaines sur 8 avec une venue");
    expect(assiduityLabel([true, false])).toBe("1 semaine sur 2 avec une venue");
  });

  it("la bande de la semaine ne « se pose » qu'à la première venue de la semaine", () => {
    const first = checkinProgress([at("2026-10-14T17:00:00Z"), at("2026-10-08T17:00:00Z")], [], TZ, NOW);
    expect(first.newStripe).toBe(true);
    const second = checkinProgress([at("2026-10-14T17:00:00Z"), at("2026-10-12T17:00:00Z")], [], TZ, NOW);
    expect(second.newStripe).toBe(false);
  });

  it("venues du mois dans le fuseau du club (le 1er à 00:30 compte pour le nouveau mois)", () => {
    const p = checkinProgress([at("2026-10-14T17:00:00Z"), at("2026-09-30T22:30:00Z"), at("2026-09-30T20:00:00Z"), at("2026-10-05T17:00:00Z", "absent")], [], TZ, NOW);
    expect(p.monthVisits).toBe(2);
  });

  it("rang du membre connecté et ex æquo", () => {
    const rows = [
      { rank: 1, isMe: false, rankedTotal: 4 },
      { rank: 2, isMe: true, rankedTotal: 4 },
      { rank: 2, isMe: false, rankedTotal: 4 },
      { rank: 4, isMe: false, rankedTotal: 4 },
    ];
    expect(myRank(rows)).toEqual({ rank: 2, tied: true, rankedTotal: 4 });
    expect(myRank([{ rank: 1, isMe: true, rankedTotal: 1 }])).toEqual({ rank: 1, tied: false, rankedTotal: 1 });
    expect(myRank([{ rank: null, isMe: true, rankedTotal: 0 }])).toEqual({ rank: null, tied: false, rankedTotal: 0 });
  });
});
