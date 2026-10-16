import { describe, expect, it } from "vitest";
import { jobHealth, sinceLabel, type JobRun } from "@/domain/monitoring";

const now = new Date("2026-10-16T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const run = (over: Partial<JobRun> = {}): JobRun => ({
  job: "reminders",
  lastRunAt: minutesAgo(2),
  lastSuccessAt: minutesAgo(2),
  lastFailureAt: null,
  lastError: null,
  successes: 10,
  failures: 0,
  ...over,
});

describe("santé d'une tâche planifiée", () => {
  it("jamais exécutée", () => {
    expect(jobHealth("reminders", null, now)).toEqual({ state: "never", minutesSinceRun: null });
  });

  it("bonne quand elle est passée récemment avec succès", () => {
    expect(jobHealth("reminders", run(), now)).toEqual({ state: "ok", minutesSinceRun: 2 });
  });

  it("en retard au-delà du délai propre à chaque tâche (rappels 15 min, clôture 2 h 30, purge 30 h)", () => {
    expect(jobHealth("reminders", run({ lastRunAt: minutesAgo(16), lastSuccessAt: minutesAgo(16) }), now).state).toBe("late");
    expect(jobHealth("reminders", run({ lastRunAt: minutesAgo(15), lastSuccessAt: minutesAgo(15) }), now).state).toBe("ok");
    expect(jobHealth("close_rolls", run({ lastRunAt: minutesAgo(120), lastSuccessAt: minutesAgo(120) }), now).state).toBe("ok");
    expect(jobHealth("close_rolls", run({ lastRunAt: minutesAgo(151), lastSuccessAt: minutesAgo(151) }), now).state).toBe("late");
    expect(jobHealth("purge", run({ lastRunAt: minutesAgo(25 * 60), lastSuccessAt: minutesAgo(25 * 60) }), now).state).toBe("ok");
    expect(jobHealth("purge", run({ lastRunAt: minutesAgo(31 * 60), lastSuccessAt: minutesAgo(31 * 60) }), now).state).toBe("late");
  });

  it("en échec quand le dernier passage a échoué, même s'il est récent ; un succès ultérieur rétablit", () => {
    expect(jobHealth("reminders", run({ lastFailureAt: minutesAgo(1), lastSuccessAt: minutesAgo(8), lastError: "x" }), now).state).toBe("failing");
    expect(jobHealth("reminders", run({ lastFailureAt: minutesAgo(8), lastSuccessAt: minutesAgo(1) }), now).state).toBe("ok");
    // Jamais réussie depuis le début : en échec.
    expect(jobHealth("purge", run({ lastSuccessAt: null, lastFailureAt: minutesAgo(2) }), now).state).toBe("failing");
  });

  it("libellé du temps écoulé", () => {
    expect(sinceLabel(0)).toBe("à l'instant");
    expect(sinceLabel(5)).toBe("il y a 5 min");
    expect(sinceLabel(120)).toBe("il y a 2 h");
    expect(sinceLabel(3 * 24 * 60)).toBe("il y a 3 j");
  });
});
