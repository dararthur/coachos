import { describe, expect, it } from "vitest";
import { formatJoinCode, normalizeJoinCode } from "@/domain/join-code";

describe("code de club", () => {
  it("normalise la saisie (casse, espaces, tirets)", () => {
    expect(normalizeJoinCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeJoinCode("  ab cd 2345 ")).toBe("ABCD2345");
  });
  it("refuse les formes invalides", () => {
    for (const bad of ["", "ABC", "ABCDEFGHI", "ABCD-EF!H", "ABCDEF01", 42, null, undefined, "A".repeat(50)]) expect(normalizeJoinCode(bad)).toBeNull();
  });
  it("formate par groupes de quatre", () => expect(formatJoinCode("ABCD2345")).toBe("ABCD-2345"));
});
