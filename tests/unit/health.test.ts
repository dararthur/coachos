import { beforeEach, describe, expect, it, vi } from "vitest";
import { readiness, resetReadinessCache, runReadiness } from "@/server/health";

const ok = async () => {};
const boom = (m: string) => async () => {
  throw new Error(m);
};

describe("disponibilité (readiness)", () => {
  beforeEach(() => resetReadinessCache());

  it("prêt seulement si TOUTES les sondes réussissent", async () => {
    expect(await runReadiness({ app_db: ok, auth_db: ok })).toEqual({ ok: true, failed: [] });
  });

  it("une dépendance essentielle en échec rend le service indisponible, et seul le NOM du contrôle est rapporté", async () => {
    const r = await runReadiness({ app_db: ok, auth_db: boom("password authentication failed for user secretuser at db.interne") });
    expect(r).toEqual({ ok: false, failed: ["auth_db"] });
    expect(JSON.stringify(r)).not.toMatch(/secretuser|db\.interne|password/);
  });

  it("toutes les sondes en échec sont listées ; une sonde qui lève de façon synchrone compte aussi", async () => {
    const r = await runReadiness({ config: () => { throw new Error("x"); }, app_db: boom("a"), auth_db: ok });
    expect(r).toEqual({ ok: false, failed: ["app_db", "config"] });
  });

  it("une sonde qui ne répond pas dans le délai est un échec (pas d'attente infinie)", async () => {
    const t0 = Date.now();
    const r = await runReadiness({ app_db: () => new Promise<void>(() => {}), auth_db: ok }, 50);
    expect(r).toEqual({ ok: false, failed: ["app_db"] });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("résultat mémorisé 3 s (une rafale ne multiplie pas les accès base), puis réévalué", async () => {
    const probe = vi.fn(ok);
    await readiness({ app_db: probe }, 1_000);
    await readiness({ app_db: probe }, 2_000);
    expect(probe).toHaveBeenCalledTimes(1);
    await readiness({ app_db: probe }, 5_000);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("récupération : une base qui revient est vue à la prochaine évaluation", async () => {
    let up = false;
    const probe = async () => {
      if (!up) throw new Error("down");
    };
    expect((await readiness({ app_db: probe }, 10_000)).ok).toBe(false);
    up = true;
    expect((await readiness({ app_db: probe }, 20_000)).ok).toBe(true);
  });

  it("aucune sonde n'est vacuement « prête » : la liste par défaut couvre configuration, base applicative et base d'authentification", async () => {
    const { defaultProbes } = await import("@/server/health");
    expect(Object.keys(defaultProbes()).sort()).toEqual(["app_db", "auth_db", "config"]);
  });
});
