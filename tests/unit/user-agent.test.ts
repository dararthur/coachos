import { describe, expect, it } from "vitest";
import { relativeDay } from "@/domain/dates";
import { describeUserAgent } from "@/domain/user-agent";

describe("appareils connectés : libellé tiré du User-Agent", () => {
  it.each([
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36", "Chrome sur Android", "phone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet sur Android", "phone"],
    ["Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Chrome sur Android", "tablet"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari sur iPhone", "phone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1", "Chrome sur iPhone", "phone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", "Safari sur iPad", "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", "Edge sur Windows", "computer"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox sur Windows", "computer"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Safari sur Mac", "computer"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0", "Opera sur Linux", "computer"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Chrome sur ChromeOS", "computer"],
  ])("%s", (ua, label, kind) => {
    expect(describeUserAgent(ua)).toEqual({ label, kind });
  });

  it("sans en-tête exploitable : « Appareil inconnu », jamais la chaîne brute", () => {
    for (const ua of [null, undefined, "", "curl/8.4.0", "<script>alert(1)</script>"]) {
      expect(describeUserAgent(ua)).toEqual({ kind: "unknown", label: "Appareil inconnu" });
    }
  });

  it("ne retient ni version ni modèle", () => {
    const { label } = describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36");
    expect(label).not.toMatch(/\d|Pixel/);
  });
});

describe("relativeDay", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  it("aujourd'hui, hier, puis la date, selon le jour local du fuseau", () => {
    expect(relativeDay(new Date("2026-10-16T00:30:00+02:00"), now, "Europe/Paris")).toBe("aujourd'hui");
    expect(relativeDay(new Date("2026-10-15T23:30:00+02:00"), now, "Europe/Paris")).toBe("hier");
    expect(relativeDay(new Date("2026-10-03T12:00:00Z"), now, "Europe/Paris")).toBe("le 3 oct. 2026");
  });
});
