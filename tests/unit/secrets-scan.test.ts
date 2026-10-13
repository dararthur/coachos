import { describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclaration de types
import { isForbiddenFile, scanText } from "../../scripts/lib/secret-patterns.mjs";

const find = (text: string): { name: string }[] => scanText(text);

describe("détection de secrets", () => {
  it("détecte une clé API Resend (valeur factice construite à la volée)", () => {
    expect(find("RESEND_KEY=" + "re_" + "A".repeat(30)).length).toBeGreaterThan(0);
    expect(find("RESEND_API_KEY=").length).toBe(0);
  });

  it("détecte des secrets typiques (valeurs factices construites à la volée)", () => {
    const fakeJwt = ["eyJ" + "a".repeat(20), "eyJ" + "b".repeat(20), "c".repeat(20)].join(".");
    expect(find(`token = ${fakeJwt}`).length).toBeGreaterThan(0);
    expect(find("-----BEGIN " + "PRIVATE KEY-----").length).toBeGreaterThan(0);
    expect(find("SUPABASE_SECRET=" + "z".repeat(40)).length).toBeGreaterThan(0);
    expect(find("DATABASE_URL=postgresql://app:" + "Abcdef123456" + "@db.example.com:5432/postgres").length).toBeGreaterThan(0);
    expect(find("key: AKIA" + "ABCDEFGHIJKLMNOP").length).toBeGreaterThan(0);
  });

  it("laisse passer les exemples et les lectures d'environnement", () => {
    expect(find("DATABASE_URL=postgresql://app_server:CHANGE_ME@127.0.0.1:54322/postgres")).toEqual([]);
    expect(find("APP_SECRET=")).toEqual([]);
    expect(find("const secret = env().CRON_SECRET;")).toEqual([]);
    expect(find("APP_SECRET: randomBytes(32).toString('hex'),")).toEqual([]);
    expect(find("DATABASE_URL: db.appUrl,")).toEqual([]);
  });

  it("refuse les .env réels mais accepte les exemples", () => {
    expect(isForbiddenFile(".env")).toBe(true);
    expect(isForbiddenFile(".env.local")).toBe(true);
    expect(isForbiddenFile("config/.env.production")).toBe(true);
    expect(isForbiddenFile(".env.example")).toBe(false);
    expect(isForbiddenFile("certs/server.pem")).toBe(true);
    expect(isForbiddenFile("src/app/page.tsx")).toBe(false);
  });
});
