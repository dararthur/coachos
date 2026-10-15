import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendSessionReminders } from "@/server/session-reminders";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const sub = async (userId: string, label: string) => {
  const p256dh = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
  const auth = randomBytes(16).toString("base64url");
  await adminSql()`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (${userId}, ${`https://fcm.googleapis.com/fcm/send/${label}-${"x".repeat(30)}`}, ${p256dh}, ${auth})`;
};

async function club(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const person = async (name: string, withAccount = true, subscribed = true) => {
    const user = await createUser(`${label}-${name}`);
    await addMember(academy, user, "member");
    const id = await createPerson(academy, name, "Test");
    if (withAccount) await adminSql()`update public.people set user_id = ${user.id} where id = ${id}`;
    if (subscribed) await sub(user.id, `${label}${name}`);
    return { user, id };
  };
  const book = (sessionId: string, personId: string, status: "booked" | "waitlisted" = "booked") =>
    adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${academy}, ${sessionId}, ${personId}, ${status})`;
  return { owner, academy, person, book };
}

const claim = () => appSql()<{ session_id: string; endpoint: string; class_name: string }[]>`select session_id, endpoint, class_name from app_private.claim_session_reminders()`;

describe("rappels de séance", () => {
  it("rappelle les inscrits (réservation confirmée, compte, appareil) d'une séance qui commence dans une heure ; une seule fois", async () => {
    const c = await club("rm1");
    const ana = await c.person("ana");
    const bob = await c.person("bob");
    const attente = await c.person("attente");
    const sansCompte = await c.person("sanscompte", false);
    const sansAppareil = await c.person("sansappareil", true, false);
    const absent = await c.person("absent"); // membre du club mais pas inscrit
    const session = await createSession(c.academy, { startsAt: inMinutes(60) });
    await c.book(session, ana.id);
    await c.book(session, bob.id);
    await c.book(session, attente.id, "waitlisted");
    await c.book(session, sansCompte.id);
    await c.book(session, sansAppareil.id);

    const first = (await claim()).filter((r) => r.session_id === session);
    expect(first.map((r) => r.endpoint).sort()).toEqual([expect.stringContaining("rm1ana"), expect.stringContaining("rm1bob")]);
    expect(first.some((r) => r.endpoint.includes("rm1absent") || r.endpoint.includes("rm1attente"))).toBe(false);
    void absent;
    expect((await claim()).filter((r) => r.session_id === session)).toHaveLength(0); // déjà rappelée
  });

  it("ignore les séances hors fenêtre (trop tôt, trop proche, passée) et les séances annulées", async () => {
    const c = await club("rm2");
    const ana = await c.person("ana");
    const early = await createSession(c.academy, { startsAt: inMinutes(120) });
    const near = await createSession(c.academy, { startsAt: inMinutes(10) });
    const past = await createSession(c.academy, { startsAt: inMinutes(-20) });
    const cancelled = await createSession(c.academy, { startsAt: inMinutes(60), status: "cancelled" });
    for (const s of [early, near, past, cancelled]) await c.book(s, ana.id);
    const ids = (await claim()).map((r) => r.session_id);
    for (const s of [early, near, past, cancelled]) expect(ids).not.toContain(s);
  });

  it("ignore une fiche archivée ou anonymisée ; une séance déplacée est rappelée pour son nouvel horaire", async () => {
    const c = await club("rm3");
    const ana = await c.person("ana");
    const gone = await c.person("archive");
    const session = await createSession(c.academy, { startsAt: inMinutes(120) });
    await c.book(session, ana.id);
    await c.book(session, gone.id);
    await adminSql()`update public.people set archived_at = now() where id = ${gone.id}`;
    expect(await claim()).toHaveLength(0); // trop tôt : non marquée
    await adminSql()`update public.sessions set starts_at = ${inMinutes(60)}::timestamptz, ends_at = ${inMinutes(120)}::timestamptz where id = ${session}`;
    const first = (await claim()).filter((r) => r.session_id === session);
    expect(first).toHaveLength(1);
    expect(first[0]!.endpoint).toContain("rm3ana");
    // Déplacée de nouveau après le rappel : la marque est effacée, le rappel repart au nouvel horaire.
    await adminSql()`update public.sessions set starts_at = ${inMinutes(45)}::timestamptz, ends_at = ${inMinutes(105)}::timestamptz where id = ${session}`;
    expect((await claim()).filter((r) => r.session_id === session)).toHaveLength(1);
  });

  it("la table et la fonction sont fermées à tous sauf app_server", async () => {
    const c = await club("rm4");
    const ana = await c.person("ana");
    expect((await failing(() => asUser(ana.user, (tx) => tx`select * from app_private.claim_session_reminders()`))).code).toBe("42501");
    expect((await failing(() => asUser(ana.user, (tx) => tx`select * from public.session_reminders`))).code).toBe("42501");
    expect((await failing(() => appSql()`select * from public.session_reminders`)).code).toBe("42501");
  });

  it("l'envoi compose le message avec l'emoji, le club, le cours et l'heure, et retire les appareils disparus", async () => {
    const c = await club("rm5");
    const ana = await c.person("ana");
    const bob = await c.person("bob");
    const session = await createSession(c.academy, { startsAt: inMinutes(61) });
    await c.book(session, ana.id);
    await c.book(session, bob.id);
    const seen: { endpoint: string; body: string }[] = [];
    const result = await sendSessionReminders({
      sql: appSql(),
      send: async (t, body) => {
        seen.push({ endpoint: t.endpoint, body });
        if (t.endpoint.includes("rm5bob")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      },
    });
    const mine = seen.filter((s) => s.endpoint.includes("rm5"));
    expect(mine).toHaveLength(2);
    const payload = JSON.parse(mine[0]!.body) as { title: string; body: string; url: string };
    expect(payload.title).toBe("🥋 Club rm5 : séance dans 1 h");
    expect(payload.body).toMatch(/Tout est prêt \?$/);
    expect(payload.url).toBe(`/a/${c.academy}/me`);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(await adminSql()`select 1 from public.push_subscriptions where endpoint like '%rm5bob%'`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.push_subscriptions where endpoint like '%rm5ana%'`).toHaveLength(1);
  });
});
