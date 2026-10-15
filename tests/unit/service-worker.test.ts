import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Exécute public/sw.js avec un faux `self` et renvoie l'adresse que la notification ouvrirait. */
function urlShownFor(payload: unknown): string {
  const handlers: Record<string, (e: unknown) => void> = {};
  const showNotification = vi.fn();
  const self = {
    location: { origin: "https://app.exemple.fr" },
    registration: { showNotification },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  new Function("self", readFileSync(path.resolve(import.meta.dirname, "../../public/sw.js"), "utf8"))(self);
  handlers.push!({ data: { json: () => payload }, waitUntil: () => {} });
  return (showNotification.mock.calls[0]![1] as { data: { url: string } }).data.url;
}

describe("service worker : une notification n'ouvre que des pages de l'application", () => {
  it("garde un chemin interne (requête et ancre comprises)", () => {
    expect(urlShownFor({ title: "t", url: "/a/1/news" })).toBe("/a/1/news");
    expect(urlShownFor({ title: "t", url: "/checkin?scan=1#x" })).toBe("/checkin?scan=1#x");
  });
  it("refuse toute autre origine, y compris les formes déguisées", () => {
    for (const url of ["https://evil.example/", "//evil.example/p", "/\\evil.example/p", "javascript:alert(1)", 42, null]) {
      expect(urlShownFor({ title: "t", url }), String(url)).toBe("/");
    }
  });
});
