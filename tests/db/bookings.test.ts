import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing, type TestUser } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Adhérent connecté, lié à sa fiche (comme après une inscription). */
async function member(academy: string, label: string) {
  const user = await createUser(label);
  await addMember(academy, user, "member");
  const person = await createPerson(academy, label, "Résa");
  await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
  return { user, person };
}

const book = (u: TestUser, session: string) => asUser(u, (tx) => tx<{ s: string }[]>`select public.book_session(${session}) as s`).then((r) => r[0]!.s);
const cancel = (u: TestUser, session: string) => asUser(u, (tx) => tx`select public.cancel_booking(${session})`);
const status = async (session: string, person: string) =>
  (await adminSql()<{ status: string }[]>`select status from public.session_bookings where session_id = ${session} and person_id = ${person}`)[0]?.status ?? null;
const setCapacity = (session: string, cap: number | null) => adminSql()`update public.sessions set capacity = ${cap} where id = ${session}`;
const future = (hours = 24) => new Date(Date.now() + hours * 3_600_000).toISOString();
const live = () => new Date(Date.now() - 10 * 60_000).toISOString();

describe("réservation, capacité et liste d'attente", () => {
  it("un membre réserve (idempotent) ; sans capacité tout le monde est inscrit", async () => {
    const owner = await createUser("bk-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    const a = await member(academy, "bk-a");
    expect(await book(a.user, session)).toBe("booked");
    expect(await book(a.user, session)).toBe("booked");
    expect(await adminSql()`select 1 from public.session_bookings where session_id = ${session}`).toHaveLength(1);
  });

  it("la capacité ne bloque pas : au-delà, liste d'attente par ordre d'arrivée ; une annulation promeut le premier", async () => {
    const owner = await createUser("bk2-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    await setCapacity(session, 2);
    const [a, b, c, d] = [await member(academy, "bk2-a"), await member(academy, "bk2-b"), await member(academy, "bk2-c"), await member(academy, "bk2-d")];
    expect(await book(a.user, session)).toBe("booked");
    expect(await book(b.user, session)).toBe("booked");
    expect(await book(c.user, session)).toBe("waitlisted");
    expect(await book(d.user, session)).toBe("waitlisted");

    // vue d'ensemble : compteurs pour tous, position seulement pour soi
    const [ov] = await asUser(d.user, (tx) => tx<{ booked: number; waitlisted: number; my_status: string; my_position: number }[]>`
      select * from public.session_bookings_overview(${academy}, now(), now() + interval '3 days')`);
    expect(ov).toMatchObject({ booked: 2, waitlisted: 2, my_status: "waitlisted", my_position: 2 });

    await cancel(a.user, session);
    expect(await status(session, a.person)).toBeNull();
    expect(await status(session, c.person)).toBe("booked"); // premier de la liste
    expect(await status(session, d.person)).toBe("waitlisted");

    // annuler depuis la liste d'attente ne promeut personne
    await cancel(d.user, session);
    expect(await status(session, b.person)).toBe("booked");
  });

  it("concurrence : 8 membres visent les 3 dernières places en même temps ; jamais plus d'inscrits que la capacité", async () => {
    const owner = await createUser("bk-race-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    await setCapacity(session, 3);
    const members = await Promise.all(Array.from({ length: 8 }, (_, i) => member(academy, `bk-race-${i}`)));
    const results = await Promise.all(members.map((m) => book(m.user, session)));
    expect(results.filter((r) => r === "booked")).toHaveLength(3);
    expect(results.filter((r) => r === "waitlisted")).toHaveLength(5);
    const [n] = await adminSql()<{ booked: number; total: number }[]>`
      select count(*) filter (where status = 'booked')::int as booked, count(*)::int as total from public.session_bookings where session_id = ${session}`;
    expect(n).toEqual({ booked: 3, total: 8 });
    // Le même membre qui appuie plusieurs fois en parallèle : une seule réservation.
    const solo = await member(academy, "bk-race-solo");
    const again = await Promise.all(Array.from({ length: 6 }, () => book(solo.user, session)));
    expect(new Set(again)).toEqual(new Set(["waitlisted"]));
    expect(await adminSql()`select 1 from public.session_bookings where session_id = ${session} and person_id = ${solo.person}`).toHaveLength(1);
  });

  it("augmenter la capacité fait avancer la liste d'attente ; la retirer inscrit tout le monde", async () => {
    const owner = await createUser("bk3-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    await setCapacity(session, 1);
    const [a, b, c] = [await member(academy, "bk3-a"), await member(academy, "bk3-b"), await member(academy, "bk3-c")];
    await book(a.user, session);
    await book(b.user, session);
    await book(c.user, session);
    await setCapacity(session, 2);
    expect(await status(session, b.person)).toBe("booked");
    expect(await status(session, c.person)).toBe("waitlisted");
    await setCapacity(session, null);
    expect(await status(session, c.person)).toBe("booked");
  });

  it("le coach fait passer un membre de la liste d'attente à inscrit, même au-delà de la capacité", async () => {
    const owner = await createUser("bk4-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    await setCapacity(session, 1);
    const [a, b] = [await member(academy, "bk4-a"), await member(academy, "bk4-b")];
    await book(a.user, session);
    await book(b.user, session);
    expect((await failing(() => asUser(a.user, (tx) => tx`select public.promote_booking(${session}, ${b.person})`))).message).toContain("coachos:forbidden");
    await asUser(owner, (tx) => tx`select public.promote_booking(${session}, ${b.person})`);
    expect(await status(session, b.person)).toBe("booked");
    expect(await adminSql()`select 1 from public.session_bookings where session_id = ${session} and status = 'booked'`).toHaveLength(2);
    expect((await failing(() => asUser(owner, (tx) => tx`select public.promote_booking(${session}, ${b.person})`))).message).toContain("coachos:not_found");
  });

  it("refus : séance annulée, terminée, feuille validée, compte sans fiche, autre club", async () => {
    const owner = await createUser("bk5-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "bk5-a");
    const cancelled = await createSession(academy, { startsAt: future(), status: "cancelled" });
    const past = await createSession(academy, { startsAt: future(-5) });
    const validated = await createSession(academy, { startsAt: live() });
    await asUser(owner, (tx) => tx`select public.roll_set_validated(${validated}, true)`);
    const err = async (s: string, u: TestUser = a.user) => (await failing(() => book(u, s))).message;
    expect(await err(cancelled)).toContain("coachos:session_cancelled");
    expect(await err(past)).toContain("coachos:booking_closed");
    expect(await err(validated)).toContain("coachos:roll_validated");

    const open = await createSession(academy, { startsAt: future() });
    const noRecord = await createUser("bk5-norecord");
    await addMember(academy, noRecord, "member");
    expect(await err(open, noRecord)).toContain("coachos:booking_no_profile");
    const stranger = await createUser("bk5-stranger");
    expect(await err(open, stranger)).toContain("coachos:not_found");
  });

  it("un membre ne voit que ses réservations ; le staff voit tout ; aucune écriture directe", async () => {
    const owner = await createUser("bk6-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    const [a, b] = [await member(academy, "bk6-a"), await member(academy, "bk6-b")];
    await book(a.user, session);
    await book(b.user, session);
    expect(await asUser(a.user, (tx) => tx`select id from public.session_bookings`)).toHaveLength(1);
    expect(await asUser(owner, (tx) => tx`select id from public.session_bookings`)).toHaveLength(2);
    expect((await failing(() => asUser(a.user, (tx) => tx`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${b.person}, 'booked')`))).message).toBeTruthy();
    expect((await failing(() => asUser(a.user, (tx) => tx`delete from public.session_bookings where person_id = ${b.person}`))).message).toBeTruthy();
  });

  it("un membre archivé libère sa place et la liste d'attente avance", async () => {
    const owner = await createUser("bk7-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    await setCapacity(session, 1);
    const [a, b] = [await member(academy, "bk7-a"), await member(academy, "bk7-b")];
    await book(a.user, session);
    await book(b.user, session);
    await adminSql()`update public.people set archived_at = now() where id = ${a.person}`;
    expect(await status(session, a.person)).toBeNull();
    expect(await status(session, b.person)).toBe("booked");
  });
});

describe("effacement définitif d'un membre", () => {
  it("libère sa place, la liste d'attente avance et l'e-mail « place confirmée » est mis en file", async () => {
    const owner = await createUser("bk7d-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    await setCapacity(session, 1);
    const [a, b] = [await member(academy, "bk7d-a"), await member(academy, "bk7d-b")];
    await book(a.user, session);
    await book(b.user, session);
    expect(await status(session, b.person)).toBe("waitlisted");
    await asUser(owner, (tx) => tx`select public.erase_person(${a.person}, 'delete')`);
    expect(await adminSql()`select 1 from public.people where id = ${a.person}`).toHaveLength(0);
    expect(await status(session, b.person)).toBe("booked");
    expect(
      await adminSql()`select 1 from public.booking_notifications n join public.session_bookings k on k.id = n.booking_id
        where k.session_id = ${session} and k.person_id = ${b.person}`,
    ).toHaveLength(1);
  });
});

describe("annulation et clôture de la feuille d'appel", () => {
  it("annulation possible tant que la feuille n'est pas validée et qu'aucune présence n'est enregistrée", async () => {
    const owner = await createUser("bk8-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: live() });
    const [a, b] = [await member(academy, "bk8-a"), await member(academy, "bk8-b")];
    await book(a.user, session);
    await book(b.user, session);
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${b.person}, 'present')`;
    expect((await failing(() => cancel(b.user, session))).message).toContain("coachos:booking_attended");
    await asUser(owner, (tx) => tx`select public.roll_set_validated(${session}, true)`);
    expect((await failing(() => cancel(a.user, session))).message).toContain("coachos:roll_validated");
    // rouverte : l'annulation redevient possible
    await asUser(owner, (tx) => tx`select public.roll_set_validated(${session}, false)`);
    await cancel(a.user, session);
    expect(await status(session, a.person)).toBeNull();
  });

  it("la validation transforme une réservation confirmée sans présence en absence ; ni la liste d'attente ni les présents ne sont touchés", async () => {
    const owner = await createUser("bk9-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: live() });
    await setCapacity(session, 2);
    const [came, noShow, waiting, walkIn] = [await member(academy, "bk9-a"), await member(academy, "bk9-b"), await member(academy, "bk9-c"), await member(academy, "bk9-d")];
    await book(came.user, session);
    await book(noShow.user, session);
    await book(waiting.user, session);
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${came.person}, 'late')`;
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${walkIn.person}, 'present')`;

    const [res] = await asUser(owner, (tx) => tx<{ r: { no_shows: number } }[]>`select public.roll_set_validated(${session}, true) as r`);
    expect(res!.r.no_shows).toBe(1);
    const att = await adminSql()<{ person_id: string; status: string }[]>`select person_id, status from public.attendance where session_id = ${session}`;
    const byPerson = Object.fromEntries(att.map((r) => [r.person_id, r.status]));
    expect(byPerson).toEqual({ [came.person]: "late", [noShow.person]: "absent", [walkIn.person]: "present" });
    expect(byPerson[waiting.person]).toBeUndefined();
  });

  it("une place libérée après le début du cours ne promeut personne : la validation ne compte pas d'absence à la personne en attente", async () => {
    const owner = await createUser("bk10-owner");
    const academy = await createAcademy(owner);
    const past = new Date(Date.now() - 3 * 3_600_000).toISOString(); // terminé depuis 2 h, feuille non validée
    for (const startsAt of [past, live()]) {
      const session = await createSession(academy, { startsAt });
      await setCapacity(session, 1);
      const [a, b, c] = [await member(academy, `bk10-a`), await member(academy, `bk10-b`), await member(academy, `bk10-c`)];
      await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at)
        values (${academy}, ${session}, ${a.person}, 'booked', now()), (${academy}, ${session}, ${b.person}, 'waitlisted', null),
               (${academy}, ${session}, ${c.person}, 'waitlisted', null)`;
      // Le membre inscrit annule après coup (permis tant que la feuille n'est pas validée), un autre est archivé.
      await cancel(a.user, session);
      expect(await status(session, b.person)).toBe("waitlisted");
      await adminSql()`update public.sessions set capacity = 5 where id = ${session}`;
      expect(await status(session, b.person)).toBe("waitlisted");
      await adminSql()`update public.people set archived_at = now() where id = ${c.person}`;
      expect(await status(session, b.person)).toBe("waitlisted");

      await asUser(owner, (tx) => tx`select public.roll_set_validated(${session}, true)`);
      expect(await adminSql()`select 1 from public.attendance where session_id = ${session} and person_id = ${b.person}`).toHaveLength(0);
      expect(await adminSql()`select 1 from public.booking_notifications n join public.session_bookings k on k.id = n.booking_id where k.session_id = ${session}`).toHaveLength(0);
    }
  });
});

describe("pointage par QR : la réservation est obligatoire", () => {
  async function openSession(label: string) {
    const owner = await createUser(`${label}-owner`);
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: live() });
    await asUser(owner, (tx) => tx`select public.checkin_open(${session})`);
    const token = randomBytes(32).toString("base64url");
    await asUser(owner, (tx) => tx`select public.checkin_issue_token(${session}, ${hash(token)}, 90)`);
    return { owner, academy, session, token };
  }
  const redeem = (u: TestUser, token: string) => asUser(u, (tx) => tx<{ r: { result: string } }[]>`select public.checkin_redeem(${hash(token)}) as r`).then((r) => r[0]!.r.result);
  const peek = (u: TestUser, token: string) => asUser(u, (tx) => tx<{ r: { booking: string | null } }[]>`select public.checkin_peek(${hash(token)}) as r`).then((r) => r[0]!.r.booking);

  it("sans réservation : refusé ; liste d'attente : refusé ; confirmé : pointé", async () => {
    const { academy, session, token } = await openSession("qb1");
    await setCapacity(session, 1);
    const [a, b, c] = [await member(academy, "qb1-a"), await member(academy, "qb1-b"), await member(academy, "qb1-c")];
    expect(await peek(a.user, token)).toBeNull();
    expect((await failing(() => redeem(a.user, token))).message).toContain("coachos:checkin_no_booking");
    await book(b.user, session);
    await book(c.user, session);
    expect(await peek(c.user, token)).toBe("waitlisted");
    expect((await failing(() => redeem(c.user, token))).message).toContain("coachos:checkin_waitlisted");
    expect(await redeem(b.user, token)).toBe("recorded");
    expect(await redeem(b.user, token)).toBe("already");
  });

  it("réserver et pointer en un geste ; reste en liste d'attente si la séance est pleine", async () => {
    const { academy, session, token } = await openSession("qb2");
    await setCapacity(session, 1);
    const [a, b] = [await member(academy, "qb2-a"), await member(academy, "qb2-b")];
    const bookAndRedeem = (u: TestUser) => asUser(u, (tx) => tx<{ r: { result: string } }[]>`select public.checkin_book_and_redeem(${hash(token)}) as r`).then((r) => r[0]!.r.result);
    expect(await bookAndRedeem(a.user)).toBe("recorded");
    expect(await status(session, a.person)).toBe("booked");
    expect(await bookAndRedeem(b.user)).toBe("waitlisted");
    expect(await status(session, b.person)).toBe("waitlisted");
  });

  it("une présence déjà saisie par le coach reste lisible sans réservation", async () => {
    const { academy, session, token } = await openSession("qb3");
    const a = await member(academy, "qb3-a");
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${a.person}, 'present')`;
    expect(await redeem(a.user, token)).toBe("already");
  });
});

describe("export des données", () => {
  it("l'export personnel inclut les réservations et le profil", async () => {
    const owner = await createUser("bk10-owner");
    const academy = await createAcademy(owner);
    const session = await createSession(academy, { startsAt: future() });
    const a = await member(academy, "bk10-a");
    await book(a.user, session);
    const [res] = await asUser(a.user, (tx) => tx<{ d: { member_records: { bookings: unknown[]; belt: unknown }[] } }[]>`select public.export_my_data() as d`);
    expect(res!.d.member_records[0]!.bookings).toHaveLength(1);
    expect(res!.d.member_records[0]).toHaveProperty("belt");
    const [adm] = await asUser(owner, (tx) => tx<{ d: { bookings: unknown[] } }[]>`select public.export_person_data(${a.person}) as d`);
    expect(adm!.d.bookings).toHaveLength(1);
  });
});
