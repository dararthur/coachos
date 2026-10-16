import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createUser, failing } from "./support";

/** Supervision (migration 001200) : état des tâches et compteurs d'envois, écrits par le serveur, lus par l'administrateur de la plateforme seul. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const record = (job: string, ok: boolean, error: string | null = null) => appSql()`select app_private.job_record(${job}, ${ok}, ${error})`;
const count = (metric: string, n: number) => appSql()`select app_private.counter_add(${metric}, ${n})`;

async function admin() {
  const u = await createUser("mon-admin");
  await appSql()`select app_private.register_platform_admin(${u.id})`;
  return u;
}

describe("tâches planifiées", () => {
  it("un succès puis un échec puis un succès : compteurs, dernier passage et erreur tenus à jour", async () => {
    const a = await admin();
    await record("purge", true);
    await record("purge", false, "purge_failed");
    let [row] = await asUser(a, (tx) => tx<{ job: string; successes: string; failures: string; last_error: string | null; last_failure_at: Date | null }[]>`select * from public.admin_job_runs() where job = 'purge'`);
    expect(row).toMatchObject({ successes: "1", failures: "1", last_error: "purge_failed" });
    expect(row!.last_failure_at).toBeInstanceOf(Date);
    await record("purge", true);
    [row] = await asUser(a, (tx) => tx<{ job: string; successes: string; failures: string; last_error: string | null; last_failure_at: Date | null }[]>`select * from public.admin_job_runs() where job = 'purge'`);
    expect(row).toMatchObject({ successes: "2", failures: "1", last_error: null });
    expect(row!.last_failure_at).toBeInstanceOf(Date); // le dernier échec reste connu
  });

  it("seules les tâches connues sont acceptées, et le code d'erreur est borné", async () => {
    expect((await failing(() => record("autre", true))).message).toMatch(/violates check constraint/);
    await record("reminders", false, "x".repeat(200));
    const [row] = await adminSql()<{ last_error: string }[]>`select last_error from public.job_runs where job = 'reminders'`;
    expect(row!.last_error).toHaveLength(60);
  });
});

describe("compteurs d'envois", () => {
  it("s'additionnent par jour et par type ; 7 et 30 jours se distinguent ; un nombre nul est ignoré", async () => {
    const a = await admin();
    const before = await asUser(a, (tx) => tx<{ metric: string; n7: string; n30: string }[]>`select * from public.admin_counters()`);
    const base = (m: string) => before.find((r) => r.metric === m)!;
    await count("mail_sent", 3);
    await count("mail_sent", 2);
    await count("mail_failed", 0);
    await adminSql()`insert into public.platform_counters (day, metric, n) values (current_date - 20, 'mail_sent', 10) on conflict (day, metric) do update set n = public.platform_counters.n + 10`;
    const after = await asUser(a, (tx) => tx<{ metric: string; n7: string; n30: string }[]>`select * from public.admin_counters()`);
    const get = (m: string) => after.find((r) => r.metric === m)!;
    expect(Number(get("mail_sent").n7) - Number(base("mail_sent").n7)).toBe(5);
    expect(Number(get("mail_sent").n30) - Number(base("mail_sent").n30)).toBe(15);
    expect(get("mail_failed").n7).toBe(base("mail_failed").n7);
    expect(after.map((r) => r.metric).sort()).toEqual(["mail_failed", "mail_sent", "push_failed", "push_gone", "push_sent"]);
  });

  it("un type inconnu est refusé ; la purge supprime au-delà de 400 jours", async () => {
    expect((await failing(() => count("pirate", 1))).message).toMatch(/violates check constraint/);
    await adminSql()`insert into public.platform_counters (day, metric, n) values (current_date - 500, 'push_sent', 4) on conflict do nothing`;
    const [row] = await appSql()<{ n: number }[]>`select app_private.purge_platform_counters() as n`;
    expect(row!.n).toBeGreaterThanOrEqual(1);
    expect(await adminSql()`select 1 from public.platform_counters where day < current_date - 400`).toHaveLength(0);
  });
});

describe("accès", () => {
  it("la lecture est réservée à l'administrateur ; les écritures au serveur ; aucune table n'est lisible par un compte", async () => {
    const a = await admin();
    const other = await createUser("mon-other");
    for (const q of ["select * from public.admin_job_runs()", "select * from public.admin_counters()"]) {
      expect((await failing(() => asUser(other, (tx) => tx.unsafe(q)))).code).toBe("42501");
      await asUser(a, (tx) => tx.unsafe(q));
    }
    expect((await failing(() => asUser(a, (tx) => tx`select app_private.job_record('purge', true, null)`))).message).toMatch(/permission denied/);
    expect((await failing(() => asUser(a, (tx) => tx`select app_private.counter_add('mail_sent', 1)`))).message).toMatch(/permission denied/);
    expect((await failing(() => asUser(a, (tx) => tx`select * from public.job_runs`))).message).toMatch(/permission denied/);
    expect((await failing(() => asUser(a, (tx) => tx`select * from public.platform_counters`))).message).toMatch(/permission denied/);
  });
});
