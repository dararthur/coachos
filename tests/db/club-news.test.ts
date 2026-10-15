import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

async function club() {
  const owner = await createUser("news-owner");
  const academy = await createAcademy(owner, "Club actus");
  const admin = await createUser("news-admin");
  const coach = await createUser("news-coach");
  const coach2 = await createUser("news-coach2");
  const member = await createUser("news-member");
  await addMember(academy, admin, "admin");
  await addMember(academy, coach, "coach");
  await addMember(academy, coach2, "coach");
  await addMember(academy, member, "member");
  return { owner, academy, admin, coach, coach2, member };
}

const publish = (u: { id: string }, academy: string, title = "Stage samedi") =>
  asUser(u, (tx) => tx<{ id: string }[]>`insert into public.club_posts (academy_id, title, body) values (${academy}, ${title}, 'Rendez-vous à 10 h.') returning id`);

describe("actualités du club", () => {
  it("l'équipe publie, le membre lit mais ne publie pas ; l'auteur est fixé par la base ; visibilité « members » par défaut", async () => {
    const c = await club();
    const [post] = await publish(c.coach, c.academy);
    const [row] = await adminSql()<{ author_id: string; visibility: string }[]>`select author_id, visibility from public.club_posts where id = ${post!.id}`;
    expect(row).toEqual({ author_id: c.coach.id, visibility: "members" });

    expect((await asUser(c.member, (tx) => tx`select id from public.club_posts where academy_id = ${c.academy}`)).length).toBe(1);
    expect((await failing(() => publish(c.member, c.academy))).message).toMatch(/row-level security/i);
  });

  it("un compte d'un autre club ne voit rien ; aucun accès sans compte", async () => {
    const c = await club();
    await publish(c.owner, c.academy);
    const stranger = await createUser("news-stranger");
    expect(await asUser(stranger, (tx) => tx`select id from public.club_posts where academy_id = ${c.academy}`)).toHaveLength(0);
    const anon = await failing(() => adminSql()`set local role anon; select id from public.club_posts`.simple());
    expect(anon.message.length).toBeGreaterThan(0);
  });

  it("un coach ne modifie ni ne supprime que ses publications ; un administrateur toutes ; le membre aucune", async () => {
    const c = await club();
    const [mine] = await publish(c.coach, c.academy, "De Carl");
    const upd = (u: { id: string }) => asUser(u, (tx) => tx`update public.club_posts set title = 'Modifié' where id = ${mine!.id}`).then((r) => r.count);
    expect(await upd(c.coach2)).toBe(0);
    expect(await upd(c.member)).toBe(0);
    expect(await upd(c.coach)).toBe(1);
    expect(await upd(c.admin)).toBe(1);
    const del = (u: { id: string }) => asUser(u, (tx) => tx`delete from public.club_posts where id = ${mine!.id}`).then((r) => r.count);
    expect(await del(c.coach2)).toBe(0);
    expect(await del(c.member)).toBe(0);
    expect(await del(c.admin)).toBe(1);
  });

  it("l'auteur et le club ne se changent pas par mise à jour ; titre et texte sont bornés", async () => {
    const c = await club();
    const [mine] = await publish(c.coach, c.academy);
    expect((await failing(() => asUser(c.coach, (tx) => tx`update public.club_posts set author_id = ${c.owner.id} where id = ${mine!.id}`))).message).toMatch(/permission denied/i);
    expect((await failing(() => asUser(c.coach, (tx) => tx`update public.club_posts set title = '   ' where id = ${mine!.id}`))).message).toMatch(/check/i);
    expect((await failing(() => asUser(c.coach, (tx) => tx`update public.club_posts set body = ${"x".repeat(5001)} where id = ${mine!.id}`))).message).toMatch(/check/i);
  });

  it("publication et suppression sont tracées ; la suppression du club n'écrit pas une trace par publication", async () => {
    const c = await club();
    const [mine] = await publish(c.coach, c.academy);
    await asUser(c.admin, (tx) => tx`delete from public.club_posts where id = ${mine!.id}`);
    const actions = (await adminSql()<{ action: string }[]>`select action from public.audit_events where academy_id = ${c.academy} and entity_id = ${mine!.id} order by id`).map((r) => r.action);
    expect(actions).toEqual(["news.published", "news.deleted"]);

    await publish(c.owner, c.academy);
    await adminSql()`delete from public.academies where id = ${c.academy}`;
    expect(await adminSql()`select 1 from public.audit_events where academy_id = ${c.academy} and action = 'news.deleted' and entity_id <> ${mine!.id}`).toHaveLength(0);
  });
});
