import { describe, expect, it } from "vitest";
import { backupWatch } from "@/domain/backup-watch";

const now = new Date("2026-10-17T03:10:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("surveillance de la sauvegarde", () => {
  it("signal jamais reçu : on ne prévient pas (rien n'est encore branché)", () => {
    expect(backupWatch(null, now)).toEqual({ state: "unknown" });
  });

  it("une nuit normale (un peu moins de 24 h à l'heure de la purge) est fraîche", () => {
    expect(backupWatch(hoursAgo(23.7), now)).toEqual({ state: "fresh", hours: 23 });
    expect(backupWatch(hoursAgo(29.9), now)).toMatchObject({ state: "fresh" });
  });

  it("à partir de 30 h, une nuit a été manquée", () => {
    expect(backupWatch(hoursAgo(30), now)).toEqual({ state: "stale", hours: 30 });
    expect(backupWatch(hoursAgo(75), now)).toEqual({ state: "stale", hours: 75 });
  });
});
