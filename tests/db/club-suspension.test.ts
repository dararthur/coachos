import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing } from "./support";

/** Suspension d'un club (migration 001500) : accès fermé jusque dans la base, données conservées, réactivation sans perte. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

async function setup(label: string) {
  const admin = await createUser(`${label}-admin`);
  await appSql()`select app_private.register_platform_admin(${admin.id})`;
  const owner = await createUser(`${label}-owner`);
  const club = await createAcademy(owner, `Club ${label}`);
  const coach = await createUser(`${label}-coach`);
  await addMember(club, coach, "coach");
  const member = await createUser(`${label}-member`);
  await addMember(club, member, "member");
  const person = await createPerson(club, "Ana", "Test");
  await adminSql()`update public.people set user_id = ${member.id} where id = ${person}`;
  return { admin, owner, club, coach, member, person };
}

const suspend = (admin: { id: string }, club: string, suspended: boolean, reason: string | null = null) =>
  asUser(admin, (tx) => tx`select public.admin_set_club_suspension(${club}, ${suspended}, ${reason})`);

describe("accès d'un club suspendu", () => {
  it("plus aucun membre n'y voit ni n'y écrit quoi que ce soit ; tout revient à la réactivation", async () => {
    const t = await setup("su1");
    const visible = (u: { id: string }) => asUser(u, (tx) => tx<{ n: number }[]>`select (select count(*) from public.people where academy_id = ${t.club})::int + (select count(*) from public.academies where id = ${t.club})::int as n`);
    for (const u of [t.owner, t.coach, t.member]) expect((await visible(u))[0]!.n).toBeGreaterThan(0);

    await suspend(t.admin, t.club, true, "Impayé");
    for (const u of [t.owner, t.coach, t.member]) expect((await visible(u))[0]!.n).toBe(0);
    expect((await asUser(t.owner, (tx) => tx<{ m: boolean }[]>`select app_private.is_member(${t.club}) as m`))[0]!.m).toBe(false);
    // Les écritures sont fermées aussi (la fonction répond comme pour un club inexistant).
    expect((await failing(() => asUser(t.coach, (tx) => tx`select public.record_promotion(${t.person}, 'blue', 0, current_date - 10)`))).message).toContain("coachos:not_found");
    expect((await failing(() => asUser(t.owner, (tx) => tx`update public.academies set name = 'Piraté' where id = ${t.club}`).then((r) => { if (r.count === 0) throw new Error("aucune ligne"); }))).message).toBe("aucune ligne");
    // Rien n'a été supprimé.
    expect(await adminSql()`select 1 from public.people where academy_id = ${t.club}`).toHaveLength(1);

    await suspend(t.admin, t.club, false);
    for (const u of [t.owner, t.coach, t.member]) expect((await visible(u))[0]!.n).toBeGreaterThan(0);
  });

  it("un autre club n'est pas touché", async () => {
    const a = await setup("su2a");
    const other = await createUser("su2b-owner");
    const otherClub = await createAcademy(other, "Club su2b");
    await suspend(a.admin, a.club, true);
    expect((await asUser(other, (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.academies where id = ${otherClub}`))[0]!.n).toBe(1);
  });
});

describe("message aux membres et réglage", () => {
  it("les membres retrouvent le nom des clubs suspendus (jamais le motif) ; un étranger n'en voit aucun", async () => {
    const t = await setup("su3");
    const stranger = await createUser("su3-stranger");
    expect(await asUser(t.member, (tx) => tx`select * from public.my_suspended_academies()`)).toHaveLength(0);
    await suspend(t.admin, t.club, true, "Motif interne confidentiel");
    const rows = await asUser(t.member, (tx) => tx<Record<string, unknown>[]>`select * from public.my_suspended_academies()`);
    expect(rows).toEqual([{ id: t.club, name: "Club su3" }]);
    expect(JSON.stringify(rows)).not.toContain("confidentiel");
    expect(await asUser(stranger, (tx) => tx`select * from public.my_suspended_academies()`)).toHaveLength(0);
  });

  it("seul l'administrateur de la plateforme règle et lit la suspension ; motif borné ; la liste des clubs l'indique", async () => {
    const t = await setup("su4");
    for (const u of [t.owner, t.coach, t.member]) {
      expect((await failing(() => suspend(u, t.club, true))).code).toBe("42501");
      expect((await failing(() => asUser(u, (tx) => tx`select * from public.admin_club_suspension(${t.club})`))).code).toBe("42501");
    }
    expect((await failing(() => suspend(t.admin, t.club, true, "x".repeat(201)))).message).toContain("coachos:validation");
    expect((await failing(() => suspend(t.admin, "00000000-0000-4000-8000-000000000000", true))).message).toContain("coachos:not_found");

    await suspend(t.admin, t.club, true, "  Impayé  ");
    const [row] = await asUser(t.admin, (tx) => tx<{ reason: string }[]>`select reason from public.admin_club_suspension(${t.club})`);
    expect(row!.reason).toBe("Impayé");
    const list = await asUser(t.admin, (tx) => tx<{ id: string; suspended_at: Date | null }[]>`select id, suspended_at from public.admin_list_clubs()`);
    expect(list.find((c) => c.id === t.club)!.suspended_at).toBeInstanceOf(Date);
    // Suspendre deux fois met à jour le motif sans doublon ; réactiver supprime la ligne.
    await suspend(t.admin, t.club, true, "Autre");
    expect(await adminSql()`select 1 from public.club_suspensions where academy_id = ${t.club}`).toHaveLength(1);
    await suspend(t.admin, t.club, false);
    expect(await adminSql()`select 1 from public.club_suspensions where academy_id = ${t.club}`).toHaveLength(0);
    expect((await failing(() => asUser(t.admin, (tx) => tx`select * from public.club_suspensions`))).message).toMatch(/permission denied/);
  });
});

describe("tâches automatiques", () => {
  it("les rappels de séance ne partent plus pour un club suspendu, et reprennent à la réactivation", async () => {
    const t = await setup("su5");
    const p256dh = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
    const auth = randomBytes(16).toString("base64url");
    await adminSql()`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (${t.member.id}, ${`https://fcm.googleapis.com/fcm/send/su5-${"x".repeat(30)}`}, ${p256dh}, ${auth})`;
    const startsAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const s1 = await createSession(t.club, { startsAt });
    await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${t.club}, ${s1}, ${t.person}, 'booked')`;

    await suspend(t.admin, t.club, true);
    const claim = () => appSql()<{ session_id: string }[]>`select session_id from app_private.claim_session_reminders()`;
    expect((await claim()).filter((r) => r.session_id === s1)).toHaveLength(0);
    await suspend(t.admin, t.club, false);
    expect((await claim()).filter((r) => r.session_id === s1)).toHaveLength(1);
  });
});
