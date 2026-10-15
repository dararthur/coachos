import { describe, expect, it, vi } from "vitest";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "@/domain/push";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/server/env", () => ({ env: () => ({}) }));
vi.mock("@/server/db/client", () => ({ withApp: async () => [] }));

const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

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
