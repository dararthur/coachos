import { describe, expect, it } from "vitest";
import { HSTS_MAX_ALLOWED, hstsHeader } from "@/server/security-headers";

const https = "https://coach.example.invalid";

describe("HSTS : émetteur unique, prudent", () => {
  it("n'émet RIEN pour development, test ou une SITE_URL en http (même en production : un en-tête HSTS en http est ignoré et trompeur)", () => {
    for (const appEnv of ["development", "test", undefined, ""]) expect(hstsHeader({ appEnv, siteUrl: https }), String(appEnv)).toBeNull();
    expect(hstsHeader({ appEnv: "production", siteUrl: "http://coach.example.invalid" })).toBeNull();
    expect(hstsHeader({ appEnv: "production", siteUrl: undefined })).toBeNull();
  });

  it("staging : 300 s ; production : 86 400 s par défaut (montée en charge explicite via HSTS_MAX_AGE_SECONDS)", () => {
    expect(hstsHeader({ appEnv: "staging", siteUrl: https })).toBe("max-age=300");
    expect(hstsHeader({ appEnv: "production", siteUrl: https })).toBe("max-age=86400");
    expect(hstsHeader({ appEnv: "production", siteUrl: https, maxAge: "604800" })).toBe("max-age=604800");
    expect(hstsHeader({ appEnv: "production", siteUrl: https, maxAge: "31536000" })).toBe("max-age=31536000");
  });

  it("borne la durée (≤ 1 an), ignore les valeurs invalides, 0 désactive (retour arrière)", () => {
    expect(hstsHeader({ appEnv: "production", siteUrl: https, maxAge: "999999999" })).toBe(`max-age=${HSTS_MAX_ALLOWED}`);
    expect(hstsHeader({ appEnv: "production", siteUrl: https, maxAge: "abc" })).toBe("max-age=86400");
    expect(hstsHeader({ appEnv: "production", siteUrl: https, maxAge: "-5" })).toBe("max-age=86400");
    expect(hstsHeader({ appEnv: "production", siteUrl: https, maxAge: "0" })).toBeNull();
  });

  it("n'inclut JAMAIS includeSubDomains ni preload, quelle que soit la configuration", () => {
    for (const appEnv of ["staging", "production"]) {
      for (const maxAge of [undefined, "300", "31536000", "999999999"]) {
        const value = hstsHeader({ appEnv, siteUrl: https, maxAge }) ?? "";
        expect(value).not.toMatch(/includeSubDomains|preload/i);
      }
    }
  });
});
