import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "@/domain/push";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/server/env", () => ({ env: () => ({}) }));
vi.mock("@/server/db/client", () => ({ withApp: async () => [] }));

const keys = { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"), auth: randomBytes(16).toString("base64url") };

describe("adresses de notification acceptées", () => {
  it("accepte les services des navigateurs, en https", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QAbc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) expect(isAllowedPushEndpoint(url), url).toBe(true);
  });

  it("refuse tout le reste : réseau interne, http, autre hôte, identifiants, port, sous-domaine piégé", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://169.254.169.254/latest/meta-data",
      "https://example.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "ftp://fcm.googleapis.com/x",
      "pas une adresse",
    ]) expect(isAllowedPushEndpoint(url), url).toBe(false);
  });

  it("valide la forme complète d'un abonnement", () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abcdef123456", keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abcdef123456", keys: { ...keys, auth: "pas valide!" } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abcdef123456" }).success).toBe(false);
  });
});

describe("envoi", () => {
  it("compte les envois, retire les appareils disparus (404/410) et n'échoue jamais pour un autre refus", async () => {
    const { deliverPush } = await import("@/server/push");
    const targets = ["ok", "gone404", "gone410", "boom"].map((id) => ({ id, endpoint: `https://fcm.googleapis.com/${id}`, p256dh: "a", auth: "b" }));
    const result = await deliverPush(targets, { title: "Club", body: "Stage", url: "/a/1/news" }, async (t) => {
      if (t.id === "gone404") throw Object.assign(new Error("x"), { statusCode: 404 });
      if (t.id === "gone410") throw Object.assign(new Error("x"), { statusCode: 410 });
      if (t.id === "boom") throw Object.assign(new Error("x"), { statusCode: 500 });
    });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.gone.sort()).toEqual(["gone404", "gone410"]);
  });
});

describe("rappel de séance : libellé", () => {
  it("« dans 1 h » autour d'une heure, sinon des minutes arrondies à 5", async () => {
    const { reminderDelay, reminderPayload } = await import("@/server/session-reminders");
    const now = new Date("2026-10-20T17:00:00Z");
    const at = (min: number) => new Date(now.getTime() + min * 60_000);
    expect(reminderDelay(at(61), now)).toBe("dans 1 h");
    expect(reminderDelay(at(56), now)).toBe("dans 1 h");
    expect(reminderDelay(at(44), now)).toBe("dans 45 min");
    expect(reminderDelay(at(36), now)).toBe("dans 35 min");
    const p = reminderPayload({ academyId: "a1", academyName: "Dojo Nord", className: "JJB — Tous niveaux", startsAt: at(60), timezone: "Europe/Paris" }, now);
    expect(p.title).toBe("🥋 Dojo Nord : séance dans 1 h");
    expect(p.body).toContain("JJB — Tous niveaux à ");
    expect(p.body.endsWith("Tout est prêt ?")).toBe(true);
    expect(p.url).toBe("/a/a1/me");
  });
});

describe("notification d'actualité : libellé", () => {
  it("titre « 📣 Du nouveau chez <club> », corps = titre de la publication, tronqué à 90 caractères", async () => {
    const { newsPayload } = await import("@/server/push");
    expect(newsPayload({ academyId: "a1", academyName: "Dojo Nord", title: "Stage de samedi" })).toEqual({ title: "📣 Du nouveau chez Dojo Nord", body: "Stage de samedi", url: "/a/a1/news" });
    expect(newsPayload({ academyId: "a1", academyName: "Dojo Nord", title: "x".repeat(200) }).body).toHaveLength(90);
  });
});
