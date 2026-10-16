import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendWeeklyDigest } from "@/server/weekly-digest";
import type { MailMessage, Mailer } from "@/server/mail/types";
import { adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

/** Récapitulatif hebdomadaire (migration 001600) : lecture serveur, un seul envoi par semaine, aucune donnée de membre. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const recorder = () => {
  const sent: MailMessage[] = [];
  const mailer: Mailer = { async send(m) { sent.push(m); } };
  return { sent, mailer };
};
const run = (r: ReturnType<typeof recorder>, options: { force?: boolean } = {}, to: string | null = "admin@example.invalid") =>
  sendWeeklyDigest(options, { sql: appSql(), mailer: r.mailer, to, siteUrl: "https://app.example.invalid", now: new Date("2026-10-18T18:00:00Z") });

describe("envoi du récapitulatif", () => {
  it("compose un message à l'administrateur avec les chiffres, sans aucune donnée de membre", async () => {
    await adminSql()`delete from public.job_runs where job = 'weekly_digest'`;
    const owner = await createUser("wd-owner");
    const club = await createAcademy(owner, "Club Récap Test");
    await adminSql()`insert into public.people (academy_id, first_name, last_name, email) values (${club}, 'Prénom', 'Secretissime', 'secret.membre@example.invalid')`;
    await adminSql()`insert into public.usage_events (academy_id, event) select ${club}, 'checkin_qr' from generate_series(1, 3)`;

    const r = recorder();
    expect(await run(r)).toMatchObject({ sent: true });
    expect(r.sent).toHaveLength(1);
    const m = r.sent[0]!;
    expect(m).toMatchObject({ to: "admin@example.invalid", kind: "weekly_digest", link: "https://app.example.invalid/admin" });
    expect(m.subject).toMatch(/^Matnexa — chiffres clés du 18 octobre/);
    expect(m.text).toContain("CLUBS");
    expect(m.text).toContain("USAGE");
    expect(m.text).toContain("SANTÉ");
    expect(m.html).toContain("Ouvrir l'administration");
    // Aucune donnée de membre dans le message.
    expect(m.text + m.html).not.toMatch(/Secretissime|secret\.membre|Prénom/);
  });

  it("n'envoie qu'une fois par semaine ; `force` passe outre ; l'échec d'envoi est relancé et enregistré", async () => {
    await adminSql()`delete from public.job_runs where job = 'weekly_digest'`;
    const first = recorder();
    expect(await run(first)).toMatchObject({ sent: true });
    const second = recorder();
    expect(await run(second)).toEqual({ sent: false, reason: "already_sent" });
    expect(second.sent).toHaveLength(0);
    expect(await run(second, { force: true })).toMatchObject({ sent: true });
    expect(second.sent).toHaveLength(1);

    await adminSql()`delete from public.job_runs where job = 'weekly_digest'`;
    const broken: Mailer = { async send() { throw new Error("fournisseur indisponible"); } };
    await expect(sendWeeklyDigest({}, { sql: appSql(), mailer: broken, to: "admin@example.invalid", siteUrl: "https://app.example.invalid", now: new Date("2026-10-18T18:00:00Z") })).rejects.toThrow("fournisseur indisponible");
    const [job] = await adminSql()<{ last_error: string; failures: string; last_success_at: Date | null }[]>`select last_error, failures, last_success_at from public.job_runs where job = 'weekly_digest'`;
    expect(job).toMatchObject({ last_error: "mail_failed", failures: "1", last_success_at: null });
    // Après un échec, le prochain déclenchement renvoie (pas de succès enregistré).
    expect(await run(recorder())).toMatchObject({ sent: true });
  });

  it("sans adresse d'administrateur configurée, rien n'est envoyé", async () => {
    const r = recorder();
    expect(await run(r, {}, null)).toEqual({ sent: false, reason: "no_recipient" });
    expect(r.sent).toHaveLength(0);
  });
});

describe("accès aux fonctions de lecture", () => {
  it("réservées au serveur : aucun compte, même administrateur de la plateforme, ne les appelle", async () => {
    const admin = await createUser("wd-admin");
    await appSql()`select app_private.register_platform_admin(${admin.id})`;
    for (const q of ["select * from app_private.club_overview()", "select app_private.digest_extra()", "select app_private.job_last_success('purge')"]) {
      expect((await failing(() => asUser(admin, (tx) => tx.unsafe(q)))).message).toMatch(/permission denied/);
    }
    // La console continue de passer par admin_list_clubs, qui garde son contrôle d'accès.
    const stranger = await createUser("wd-stranger");
    expect((await failing(() => asUser(stranger, (tx) => tx`select * from public.admin_list_clubs()`))).code).toBe("42501");
    expect((await asUser(admin, (tx) => tx`select * from public.admin_list_clubs()`)).length).toBeGreaterThan(0);
    // Les chiffres du serveur et ceux de la console sont les mêmes.
    const viaServer = await appSql()<{ id: string }[]>`select id from app_private.club_overview()`;
    const viaConsole = await asUser(admin, (tx) => tx<{ id: string }[]>`select id from public.admin_list_clubs()`);
    expect(viaServer.map((r) => r.id).sort()).toEqual(viaConsole.map((r) => r.id).sort());
  });
});
