import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const endpoint = (label: string) => `https://fcm.googleapis.com/fcm/send/${label}-${"x".repeat(30)}`;
// Valeurs factices de forme valide (pas de littéral : un détecteur de secrets les prendrait pour de vraies clés).
const P256DH = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
const AUTH = randomBytes(16).toString("base64url");

const save = (u: { id: string }, ep: string) => asUser(u, (tx) => tx`select app_private.save_push_subscription(${ep}, ${P256DH}, ${AUTH})`);

describe("abonnements aux notifications push", () => {
  it("un compte enregistre ses appareils, les voit et les supprime ; il ne voit jamais ceux d'un autre", async () => {
    const a = await createUser("push-a");
    const b = await createUser("push-b");
    await save(a, endpoint("a1"));
    await save(b, endpoint("b1"));
    expect((await asUser(a, (tx) => tx`select endpoint from public.push_subscriptions`)).map((r) => r.endpoint)).toEqual([endpoint("a1")]);
    // Supprimer l'appareil d'un autre : aucune ligne touchée.
    expect((await asUser(a, (tx) => tx`delete from public.push_subscriptions where endpoint = ${endpoint("b1")}`)).count).toBe(0);
    expect((await asUser(a, (tx) => tx`delete from public.push_subscriptions where endpoint = ${endpoint("a1")}`)).count).toBe(1);
    expect(await asUser(b, (tx) => tx`select id from public.push_subscriptions`)).toHaveLength(1);
  });

  it("aucune écriture directe : ni insertion, ni modification, ni accès sans compte", async () => {
    const a = await createUser("push-direct");
    await save(a, endpoint("d1"));
    const insert = await failing(() => asUser(a, (tx) => tx`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (${a.id}, ${endpoint("d2")}, ${P256DH}, ${AUTH})`));
    expect(insert.code).toBe("42501");
    const update = await failing(() => asUser(a, (tx) => tx`update public.push_subscriptions set user_id = gen_random_uuid()`));
    expect(update.code).toBe("42501");
    const anon = await failing(() => adminSql()`set local role anon; select id from public.push_subscriptions`.simple());
    expect(anon.message.length).toBeGreaterThan(0);
    expect((await failing(() => adminSql()`set local role anon; select app_private.save_push_subscription('https://x', 'a', 'b')`.simple())).message.length).toBeGreaterThan(0);
  });

  it("un appareil qui change de compte passe au compte courant : l'ancien titulaire ne reçoit plus rien", async () => {
    const first = await createUser("push-first");
    const second = await createUser("push-second");
    await save(first, endpoint("shared"));
    await save(second, endpoint("shared"));
    expect(await asUser(first, (tx) => tx`select id from public.push_subscriptions`)).toHaveLength(0);
    expect(await asUser(second, (tx) => tx`select id from public.push_subscriptions`)).toHaveLength(1);
  });

  it("valeurs bornées (https obligatoire) et au plus 10 appareils par compte", async () => {
    const u = await createUser("push-cap");
    expect((await failing(() => asUser(u, (tx) => tx`select app_private.save_push_subscription('http://fcm.googleapis.com/fcm/send/aaaaaaaaaaaa', ${P256DH}, ${AUTH})`))).message).toMatch(/check/i);
    expect((await failing(() => asUser(u, (tx) => tx`select app_private.save_push_subscription(${endpoint("k")}, 'court', ${AUTH})`))).message).toMatch(/check/i);
    for (let i = 0; i < 12; i++) await save(u, endpoint(`cap${i}`));
    expect(await asUser(u, (tx) => tx`select id from public.push_subscriptions`)).toHaveLength(10);
  });

  it("la suppression du compte emporte ses appareils", async () => {
    const u = await createUser("push-del");
    await save(u, endpoint("gone"));
    await adminSql()`delete from auth.users where id = ${u.id}`;
    expect(await adminSql()`select 1 from public.push_subscriptions where endpoint = ${endpoint("gone")}`).toHaveLength(0);
  });
});

describe("envoi aux membres d'un club", () => {
  it("app_server ne reçoit que les appareils des membres du club, hors l'auteur ; les autres rôles n'y ont pas accès", async () => {
    const owner = await createUser("push-owner");
    const academy = await createAcademy(owner, "Club push");
    const coach = await createUser("push-coach");
    const member = await createUser("push-member");
    const outsider = await createUser("push-outsider");
    await addMember(academy, coach, "coach");
    await addMember(academy, member, "member");
    for (const [u, l] of [[owner, "o"], [coach, "c"], [member, "m"], [outsider, "x"]] as const) await save(u, endpoint(`club-${l}`));

    const rows = await appSql()<{ id: string; endpoint: string }[]>`select id, endpoint from app_private.push_targets_for_club(${academy}, ${coach.id})`;
    expect(rows.map((r) => r.endpoint).sort()).toEqual([endpoint("club-m"), endpoint("club-o")]);

    for (const u of [member, outsider]) {
      expect((await failing(() => asUser(u, (tx) => tx`select * from app_private.push_targets_for_club(${academy}, null)`))).code).toBe("42501");
      expect((await failing(() => asUser(u, (tx) => tx`select app_private.drop_push_subscriptions(array[gen_random_uuid()])`))).code).toBe("42501");
    }
    expect((await failing(() => appSql()`select * from public.push_subscriptions`)).code).toBe("42501");

    await appSql()`select app_private.drop_push_subscriptions(${appSql().array(rows.map((r) => r.id))}::uuid[])`;
    const left = await appSql()<{ endpoint: string }[]>`select endpoint from app_private.push_targets_for_club(${academy}, null)`;
    expect(left.map((r) => r.endpoint)).toEqual([endpoint("club-c")]); // propriétaire et membre supprimés, le coach reste
  });
});
