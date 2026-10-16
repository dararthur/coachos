import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { alertIfBackupStale } from "@/server/backup-watch";
import type { MailMessage, Mailer } from "@/server/mail/types";
import { adminSql, appSql, buildWorld, closeAll, failing } from "./support";

/** Dead man's switch de la sauvegarde (migration 001700) : le signal est enregistré, l'absence prolongée prévient l'administrateur. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);
beforeEach(async () => {
  await adminSql()`delete from public.job_runs where job = 'backup'`;
});

const now = new Date("2026-10-17T03:10:00Z");
const recorder = () => {
  const sent: MailMessage[] = [];
  const mailer: Mailer = { async send(m) { sent.push(m); } };
  return { sent, mailer };
};
const check = (r: ReturnType<typeof recorder>, to: string | null = "admin@example.invalid") =>
  alertIfBackupStale({ sql: appSql(), mailer: r.mailer, to, now, siteUrl: "https://app.example.invalid" });
const setBackup = (hoursAgo: number) =>
  adminSql()`insert into public.job_runs (job, last_run_at, last_success_at, successes) values ('backup', now(), ${new Date(now.getTime() - hoursAgo * 3_600_000)}, 1)
             on conflict (job) do update set last_success_at = excluded.last_success_at`;

describe("alerte de sauvegarde manquée", () => {
  it("rien tant que le signal n'a jamais été reçu", async () => {
    const r = recorder();
    expect(await check(r)).toBe(false);
    expect(r.sent).toHaveLength(0);
  });

  it("rien quand la sauvegarde est récente", async () => {
    await setBackup(23);
    const r = recorder();
    expect(await check(r)).toBe(false);
    expect(r.sent).toHaveLength(0);
  });

  it("prévient l'administrateur quand elle date de 30 h ou plus, sans donnée de membre", async () => {
    await setBackup(52);
    const r = recorder();
    expect(await check(r)).toBe(true);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ to: "admin@example.invalid", kind: "admin_alert", link: "https://app.example.invalid/admin" });
    expect(r.sent[0]!.subject).toBe("La sauvegarde n'a pas été faite — Matnexa");
    expect(r.sent[0]!.text).toContain("52 heures");
  });

  it("sans adresse d'administrateur rien ne part, et un échec d'envoi ne fait jamais échouer la purge", async () => {
    await setBackup(52);
    const r = recorder();
    expect(await check(r, null)).toBe(false);
    expect(r.sent).toHaveLength(0);
    const broken: Mailer = { async send() { throw new Error("fournisseur indisponible"); } };
    expect(await alertIfBackupStale({ sql: appSql(), mailer: broken, to: "admin@example.invalid", now, siteUrl: "https://app.example.invalid" })).toBe(false);
  });
});

describe("signal de la tâche", () => {
  it("le signal 'backup' est une tâche connue de la supervision ; un autre nom reste refusé", async () => {
    await appSql()`select app_private.job_record('backup', true, null)`;
    const [row] = await adminSql()<{ successes: string }[]>`select successes from public.job_runs where job = 'backup'`;
    expect(row!.successes).toBe("1");
    expect((await failing(() => appSql()`select app_private.job_record('autre', true, null)`)).message).toMatch(/violates check constraint/);
  });
});
