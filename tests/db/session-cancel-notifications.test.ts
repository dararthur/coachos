import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deliverBookingPromotions, notificationPayload } from "@/server/booking-notifications";
import type { Mailer, MailMessage } from "@/server/mail/types";
import type { PushSender } from "@/server/push";
import { addMember, adminSql, appSql, asUser, closeAll, createAcademy, createPerson, createSession, createUser } from "./support";

/**
 * P1.4 : « séance annulée » et « place confirmée » en e-mail ET en push, par la file de la migration 0022 (type 'cancelled' / 'promoted').
 */
afterAll(closeAll);
beforeEach(async () => {
  await adminSql()`delete from public.booking_notifications`;
});

const SITE = "https://club.example";
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function mailRecorder() {
  const sent: MailMessage[] = [];
  const mailer: Mailer = { async send(m) { sent.push(m); } };
  return { sent, mailer };
}
function pushRecorder(failWith?: { statusCode: number }) {
  const sent: { endpoint: string; body: { title: string; body: string; url: string } }[] = [];
  const send: PushSender = async (t, body) => {
    if (failWith) throw Object.assign(new Error("push"), failWith);
    sent.push({ endpoint: t.endpoint, body: JSON.parse(body) });
  };
  return { sent, send };
}
const deliver = (mailer: Mailer, send: PushSender) => deliverBookingPromotions({ sql: appSql(), mailer, siteUrl: SITE, send });

async function member(academy: string, label: string, subscribed: boolean) {
  const user = await createUser(label);
  await addMember(academy, user, "member");
  const person = await createPerson(academy, label, "Zeta");
  await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
  const endpoint = `https://fcm.googleapis.com/fcm/send/${label}-${"x".repeat(30)}`;
  if (subscribed) {
    await adminSql()`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values (${user.id}, ${endpoint}, ${Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url")}, ${randomBytes(16).toString("base64url")})`;
  }
  return { user, person, endpoint };
}
const book = (u: { id: string; email: string }, session: string) => asUser(u, (tx) => tx`select public.book_session(${session})`);
const cancelSession = (session: string) => adminSql()`update public.sessions set status = 'cancelled' where id = ${session}`;
const queued = () => adminSql()<{ kind: string }[]>`select kind from public.booking_notifications order by created_at`.then((r) => r.map((x) => x.kind));

describe("séance annulée : e-mail et push aux inscrits", () => {
  it("prévient chaque réservation confirmée (jamais la liste d'attente ni le coach), texte neutre, une seule fois", async () => {
    const owner = await createUser("sc1-owner");
    const academy = await createAcademy(owner, "Club SC1");
    const coach = await createUser("sc1-coach");
    await addMember(academy, coach, "coach");
    const session = await createSession(academy, { startsAt: inHours(30), instructor: coach.id });
    const ana = await member(academy, "sc1-ana", true);
    const bob = await member(academy, "sc1-bob", false);
    const cleo = await member(academy, "sc1-cleo", true);
    for (const m of [ana, bob, cleo]) await book(m.user, session);
    await adminSql()`update public.session_bookings set status = 'waitlisted' where person_id = ${cleo.person}`;
    await adminSql()`delete from public.booking_notifications`;

    await cancelSession(session);
    expect(await queued()).toEqual(["cancelled", "cancelled"]); // ana et bob seulement

    const mails = mailRecorder();
    const pushes = pushRecorder();
    expect(await deliver(mails.mailer, pushes.send)).toEqual({ sent: 2, failed: 0 });
    expect(mails.sent.map((m) => m.to).sort()).toEqual([ana.user.email, bob.user.email].sort());
    expect(mails.sent.every((m) => m.kind === "session_cancelled" && m.link === `${SITE}/a/${academy}/schedule`)).toBe(true);

    // Push : seulement pour l'adhérent abonné, texte neutre (ni cours, ni horaire, ni nom).
    expect(pushes.sent).toHaveLength(1);
    expect(pushes.sent[0]!.endpoint).toBe(ana.endpoint);
    const payload = pushes.sent[0]!.body;
    expect(payload).toEqual({ title: "Club SC1 : séance annulée", body: "Une séance que vous aviez réservée est annulée.", url: `/a/${academy}/schedule` });
    expect(JSON.stringify(payload)).not.toMatch(/Zeta|sc1-/);

    expect(await queued()).toEqual([]);
    const again = mailRecorder();
    expect(await deliver(again.mailer, pushRecorder().send)).toEqual({ sent: 0, failed: 0 });
    expect(again.sent).toEqual([]);
  });

  it("rien ne part si la séance est réactivée avant l'envoi, si elle est déjà passée, ou si la réservation est annulée", async () => {
    const owner = await createUser("sc2-owner");
    const academy = await createAcademy(owner, "Club SC2");
    const future = await createSession(academy, { startsAt: inHours(48) });
    const past = await createSession(academy, { startsAt: inHours(-5) });
    const kept = await createSession(academy, { startsAt: inHours(72) });
    const m = await member(academy, "sc2-m", true);
    await book(m.user, future);
    await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${academy}, ${past}, ${m.person}, 'booked'), (${academy}, ${kept}, ${m.person}, 'booked')`;
    await adminSql()`delete from public.booking_notifications`;

    await cancelSession(past);
    expect(await queued()).toEqual([]); // séance passée : rien en file

    await cancelSession(future);
    await adminSql()`update public.sessions set status = 'scheduled' where id = ${future}`; // réactivée avant l'envoi
    await cancelSession(kept);
    await asUser(m.user, (tx) => tx`select public.cancel_booking(${kept})`).catch(() => undefined); // réservation annulée par l'adhérent
    await adminSql()`delete from public.session_bookings where session_id = ${kept}`;

    const mails = mailRecorder();
    const pushes = pushRecorder();
    expect(await deliver(mails.mailer, pushes.send)).toEqual({ sent: 0, failed: 0 });
    expect(mails.sent).toEqual([]);
    expect(pushes.sent).toEqual([]);
  });

  it("un appareil disparu (410) est supprimé ; un échec push ne rejoue pas l'e-mail", async () => {
    const owner = await createUser("sc3-owner");
    const academy = await createAcademy(owner, "Club SC3");
    const session = await createSession(academy, { startsAt: inHours(30) });
    const m = await member(academy, "sc3-m", true);
    await book(m.user, session);
    await adminSql()`delete from public.booking_notifications`;
    await cancelSession(session);

    const mails = mailRecorder();
    expect(await deliver(mails.mailer, pushRecorder({ statusCode: 410 }).send)).toEqual({ sent: 1, failed: 0 });
    expect(await adminSql()`select 1 from public.push_subscriptions where user_id = ${m.user.id}`).toHaveLength(0);
    expect(await queued()).toEqual([]);
    expect(mails.sent).toHaveLength(1);
  });
});

describe("place confirmée : aussi en push", () => {
  it("la promotion depuis la liste d'attente envoie l'e-mail puis la notification neutre", async () => {
    const owner = await createUser("sc4-owner");
    const academy = await createAcademy(owner, "Club SC4");
    const session = await createSession(academy, { startsAt: inHours(30) });
    await adminSql()`update public.sessions set capacity = 1 where id = ${session}`;
    const first = await member(academy, "sc4-first", false);
    const next = await member(academy, "sc4-next", true);
    await book(first.user, session);
    await book(next.user, session);
    await adminSql()`delete from public.booking_notifications`;
    await asUser(first.user, (tx) => tx`select public.cancel_booking(${session})`);
    expect(await queued()).toEqual(["promoted"]);

    const mails = mailRecorder();
    const pushes = pushRecorder();
    expect(await deliver(mails.mailer, pushes.send)).toEqual({ sent: 1, failed: 0 });
    expect(mails.sent[0]!.kind).toBe("booking_promoted");
    expect(pushes.sent).toHaveLength(1);
    expect(pushes.sent[0]!.body).toEqual(notificationPayload({ kind: "promoted", academyId: academy, academyName: "Club SC4" }));
    expect(pushes.sent[0]!.body.body).not.toMatch(/JJB|Zeta|sc4-/);
  });
});
