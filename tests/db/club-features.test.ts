import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createUser, failing } from "./support";

/** Fonctionnalités activables club par club (migration 000900) : réglage réservé à l'administrateur, blocage jusque dans la base, données conservées. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const registerAdmin = (id: string) => appSql()`select app_private.register_platform_admin(${id})`;
const setFeature = (admin: { id: string }, academy: string, feature: string, enabled: boolean) =>
  asUser(admin, (tx) => tx`select public.admin_set_club_feature(${academy}, ${feature}, ${enabled})`);

async function club(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const coach = await createUser(`${label}-coach`);
  await addMember(academy, coach, "coach");
  const member = await createUser(`${label}-member`);
  await addMember(academy, member, "member");
  const person = await createPerson(academy, "Ana", "Test");
  await adminSql()`update public.people set user_id = ${member.id} where id = ${person}`;
  return { owner, academy, coach, member, person };
}

describe("réglage des fonctionnalités", () => {
  it("tout est activé par défaut ; seul l'administrateur de la plateforme règle, un propriétaire de club ne peut pas se donner ou retirer un module", async () => {
    const admin = await createUser("feat-admin");
    await registerAdmin(admin.id);
    const c = await club("feat1");
    const all = await asUser(admin, (tx) => tx<{ feature: string; enabled: boolean }[]>`select * from public.admin_club_features(${c.academy})`);
    expect(all).toEqual([
      { feature: "news", enabled: true },
      { feature: "ranking", enabled: true },
      { feature: "reports", enabled: true },
    ]);

    for (const who of [c.owner, c.coach, c.member]) {
      expect((await failing(() => setFeature(who, c.academy, "news", false))).code).toBe("42501");
      expect((await failing(() => asUser(who, (tx) => tx`select * from public.admin_club_features(${c.academy})`))).code).toBe("42501");
    }
    // Ni écriture directe, ni autre valeur que les trois modules.
    expect((await failing(() => asUser(c.owner, (tx) => tx`insert into public.club_features (academy_id, feature, enabled) values (${c.academy}, 'news', false)`))).message).toMatch(/permission denied/);
    expect((await failing(() => setFeature(admin, c.academy, "paiements", false))).message).toContain("coachos:validation");
    expect((await failing(() => setFeature(admin, "00000000-0000-4000-8000-000000000000", "news", false))).message).toContain("coachos:not_found");
  });

  it("le réglage est tracé dans le journal du club, et les membres du club (et eux seuls) lisent leurs interrupteurs", async () => {
    const admin = await createUser("feat-admin2");
    await registerAdmin(admin.id);
    const c = await club("feat2");
    const stranger = await createUser("feat2-stranger");
    await setFeature(admin, c.academy, "ranking", false);

    const rows = (u: { id: string }) => asUser(u, (tx) => tx<{ feature: string; enabled: boolean }[]>`select feature, enabled from public.club_features where academy_id = ${c.academy}`);
    expect(await rows(c.member)).toEqual([{ feature: "ranking", enabled: false }]);
    expect(await rows(stranger)).toHaveLength(0);
    const [audit] = await adminSql()<{ action: string; details: Record<string, unknown> }[]>`
      select action, metadata as details from public.audit_events where academy_id = ${c.academy} and action = 'platform.feature_set'`;
    expect(audit).toMatchObject({ action: "platform.feature_set", details: { feature: "ranking", enabled: false } });

    // Réactivation : la ligne est mise à jour, pas dupliquée.
    await setFeature(admin, c.academy, "ranking", true);
    expect(await rows(c.member)).toEqual([{ feature: "ranking", enabled: true }]);
  });

  it("la liste des clubs indique les modules coupés", async () => {
    const admin = await createUser("feat-admin3");
    await registerAdmin(admin.id);
    const c = await club("feat3");
    await setFeature(admin, c.academy, "news", false);
    await setFeature(admin, c.academy, "reports", false);
    const rows = await asUser(admin, (tx) => tx<{ id: string; disabled_features: string[] }[]>`select id, disabled_features from public.admin_list_clubs()`);
    expect(rows.find((r) => r.id === c.academy)?.disabled_features).toEqual(["news", "reports"]);
  });
});

describe("blocage dans la base", () => {
  it("actualités coupées : plus de lecture ni d'écriture pour le club ; les articles existants sont conservés et reviennent à la réactivation", async () => {
    const admin = await createUser("feat-admin4");
    await registerAdmin(admin.id);
    const c = await club("feat4");
    const publish = (title: string) => asUser(c.coach, (tx) => tx`insert into public.club_posts (academy_id, title, body) values (${c.academy}, ${title}, 'Texte') returning id`);
    await publish("Avant");

    await setFeature(admin, c.academy, "news", false);
    expect(await asUser(c.member, (tx) => tx`select id from public.club_posts where academy_id = ${c.academy}`)).toHaveLength(0);
    expect(await asUser(c.coach, (tx) => tx`select id from public.club_posts where academy_id = ${c.academy}`)).toHaveLength(0);
    expect((await failing(() => publish("Pendant"))).message).toMatch(/row-level security/);
    expect(await adminSql()`select id from public.club_posts where academy_id = ${c.academy}`).toHaveLength(1);

    await setFeature(admin, c.academy, "news", true);
    expect(await asUser(c.member, (tx) => tx`select id from public.club_posts where academy_id = ${c.academy}`)).toHaveLength(1);
    await publish("Après");
  });

  it("classement coupé : la fonction du classement refuse aux membres du club, un autre club n'est pas touché", async () => {
    const admin = await createUser("feat-admin5");
    await registerAdmin(admin.id);
    const off = await club("feat5a");
    const on = await club("feat5b");
    const ranking = (c: { academy: string; member: { id: string } }) =>
      asUser(c.member, (tx) => tx`select * from public.attendance_ranking(${c.academy}, current_date - 30, current_date)`);
    await ranking(off);
    await setFeature(admin, off.academy, "ranking", false);
    expect((await failing(() => ranking(off))).message).toContain("coachos:feature_disabled");
    await ranking(on);
    await setFeature(admin, off.academy, "ranking", true);
    await ranking(off);
  });

  it("grades coupés : enregistrer un passage ou une date de ceinture est refusé, mais modifier la ceinture de la fiche reste possible", async () => {
    const admin = await createUser("feat-admin6");
    await registerAdmin(admin.id);
    const c = await club("feat6");
    await setFeature(admin, c.academy, "reports", false);

    expect((await failing(() => asUser(c.coach, (tx) => tx`select public.record_promotion(${c.person}, 'blue', 0, current_date - 10)`))).message).toContain("coachos:feature_disabled");
    expect((await failing(() => asUser(c.coach, (tx) => tx`select public.set_belt_since(${c.person}, current_date - 10)`))).message).toContain("coachos:feature_disabled");
    // Les fonctions internes ne sont pas exécutables par les comptes : le contrôle ne se contourne pas.
    expect((await failing(() => asUser(c.coach, (tx) => tx`select app_private.record_promotion_core(${c.person}, 'blue', 0, current_date - 10)`))).message).toMatch(/permission denied/);

    // La fiche reste modifiable (la ceinture n'est pas un module), et le journal des grades se tient à jour.
    await asUser(c.coach, (tx) => tx`update public.people set belt = 'white' where id = ${c.person}`);

    await setFeature(admin, c.academy, "reports", true);
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${c.person}, 'blue', 0, current_date - 10)`);
  });
});
