import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schedule from "@/server/repositories/schedule";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createUser, failing, firstClassType } from "./support";

/**
 * Récurrences : modifier ou supprimer une séance, elle et les suivantes de sa série, ou toutes les séances à venir de la série.
 * Une séance commencée n'est jamais touchée ; une séance avec des inscrits est annulée (ils sont prévenus), jamais supprimée en silence.
 */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const TZ = "Europe/Paris";
const localOf = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
const inDays = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 86_400_000));

async function club(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const coach = await createUser(`${label}-coach`);
  await addMember(academy, coach, "coach");
  const classTypeId = await firstClassType(academy);
  return { owner, coach, academy, classTypeId };
}

/** Série hebdomadaire de 4 séances (J+7, J+14, J+21, J+28), triée par date. */
async function weeklySeries(c: Awaited<ReturnType<typeof club>>, time = "19:00") {
  const dates = [7, 14, 21, 28].map(inDays);
  await asUser(c.owner, (tx) => schedule.createSessions(tx, c.academy, { classTypeId: c.classTypeId, instructorId: null, dates, time, durationMinutes: 60, capacity: null, notes: null }));
  return adminSql()<{ id: string; starts_at: Date; ends_at: Date; status: string; series_id: string; capacity: number | null; notes: string | null }[]>`
    select id, starts_at, ends_at, status, series_id, capacity, notes from public.sessions where academy_id = ${c.academy} order by starts_at`;
}
const reload = (academy: string) =>
  adminSql()<{ id: string; starts_at: Date; ends_at: Date; status: string; capacity: number | null; notes: string | null }[]>`
    select id, starts_at, ends_at, status, capacity, notes from public.sessions where academy_id = ${academy} order by starts_at`;

describe("modifier une série", () => {
  it("« cette séance et les suivantes » : chaque séance garde son jour, prend l'heure, la durée, les places et la note ; les précédentes ne bougent pas", async () => {
    const c = await club("sr1");
    const s = await weeklySeries(c);
    expect(new Set(s.map((x) => x.series_id)).size).toBe(1);
    const n = await asUser(c.owner, (tx) => schedule.updateSessionSeries(tx, c.academy, s[1]!.id, "following", { instructorId: null, time: "18:30", durationMinutes: 90, capacity: 12, notes: "Nouvel horaire" }));
    expect(n).toBe(3);
    const after = await reload(c.academy);
    expect(localOf(after[0]!.starts_at)).toBe(localOf(s[0]!.starts_at)); // la première n'a pas bougé
    for (let i = 1; i < 4; i++) {
      expect(localOf(after[i]!.starts_at)).toBe(`${localOf(s[i]!.starts_at).slice(0, 10)} 18:30`); // même jour, nouvelle heure
      expect((after[i]!.ends_at.getTime() - after[i]!.starts_at.getTime()) / 60_000).toBe(90);
      expect(after[i]).toMatchObject({ capacity: 12, notes: "Nouvel horaire" });
    }
  });

  it("« toutes les séances à venir » depuis n'importe quelle séance ; une séance déjà commencée de la série n'est jamais touchée", async () => {
    const c = await club("sr2");
    const s = await weeklySeries(c);
    // Une séance de la même série, commencée il y a une heure (historique).
    const [past] = await adminSql()<{ id: string; starts_at: Date }[]>`
      insert into public.sessions (academy_id, class_type_id, starts_at, ends_at, series_id)
      values (${c.academy}, ${c.classTypeId}, now() - interval '1 hour', now() + interval '30 minutes', ${s[0]!.series_id}) returning id, starts_at`;
    const n = await asUser(c.owner, (tx) => schedule.updateSessionSeries(tx, c.academy, s[3]!.id, "upcoming", { instructorId: null, time: "07:00", durationMinutes: 60, capacity: null, notes: null }));
    expect(n).toBe(4);
    const [p] = await adminSql()<{ starts_at: Date }[]>`select starts_at from public.sessions where id = ${past!.id}`;
    expect(p!.starts_at.getTime()).toBe(past!.starts_at.getTime());
    expect(await asUser(c.owner, (tx) => schedule.seriesInfo(tx, c.academy, s[0]!.id))).toMatchObject({ following: 4, upcoming: 4 });
  });

  it("changement d'heure (fin octobre) : 19:00 reste 19:00 à l'heure locale des deux côtés", async () => {
    const c = await club("sr3");
    // Deux mardis encadrant le passage à l'heure d'hiver du 25 octobre 2026, dans l'avenir lors de l'écriture du test.
    const dates = ["2026-10-20", "2026-10-27"].filter((d) => d > inDays(0));
    if (dates.length < 2) return; // le test date d'avant cette transition ; les dates futures du test précédent couvrent le cas général
    await asUser(c.owner, (tx) => schedule.createSessions(tx, c.academy, { classTypeId: c.classTypeId, instructorId: null, dates, time: "20:00", durationMinutes: 60, capacity: null, notes: null }));
    const s = await reload(c.academy);
    await asUser(c.owner, (tx) => schedule.updateSessionSeries(tx, c.academy, s[0]!.id, "following", { instructorId: null, time: "19:00", durationMinutes: 60, capacity: null, notes: null }));
    const after = await reload(c.academy);
    expect(after.map((x) => localOf(x.starts_at))).toEqual(["2026-10-20 19:00", "2026-10-27 19:00"]);
    expect(after[1]!.starts_at.getTime() - after[0]!.starts_at.getTime()).toBe(7 * 86_400_000 + 3_600_000); // une heure de plus en UTC
  });

  it("collision avec une autre séance du même cours : rien n'est modifié", async () => {
    const c = await club("sr4");
    const s = await weeklySeries(c);
    await adminSql()`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at)
      values (${c.academy}, ${c.classTypeId}, (${inDays(21)}::date + time '08:00') at time zone ${TZ}, (${inDays(21)}::date + time '09:00') at time zone ${TZ})`;
    const err = await failing(() => asUser(c.owner, (tx) => schedule.updateSessionSeries(tx, c.academy, s[0]!.id, "upcoming", { instructorId: null, time: "08:00", durationMinutes: 60, capacity: null, notes: null })));
    expect(err.code).toBe("23505");
    const after = await reload(c.academy);
    expect(after.filter((x) => localOf(x.starts_at).endsWith("19:00"))).toHaveLength(4);
  });

  it("un coach ne modifie aucune séance de la série (RLS), un autre club non plus", async () => {
    const c = await club("sr5");
    const s = await weeklySeries(c);
    expect(await asUser(c.coach, (tx) => schedule.updateSessionSeries(tx, c.academy, s[0]!.id, "upcoming", { instructorId: null, time: "06:00", durationMinutes: 60, capacity: null, notes: null }))).toBe(0);
    const other = await club("sr5b");
    expect(await asUser(other.owner, (tx) => schedule.updateSessionSeries(tx, c.academy, s[0]!.id, "upcoming", { instructorId: null, time: "06:00", durationMinutes: 60, capacity: null, notes: null }))).toBe(0);
    expect((await reload(c.academy)).every((x) => localOf(x.starts_at).endsWith("19:00"))).toBe(true);
  });
});

describe("supprimer une série", () => {
  it("les séances avec inscrits sont annulées (inscrits prévenus), les autres supprimées ; la séance commencée reste", async () => {
    const c = await club("sr6");
    const s = await weeklySeries(c);
    const member = await createUser("sr6-member");
    await addMember(c.academy, member, "member");
    const person = await createPerson(c.academy, "Ines", "Inscrite");
    await adminSql()`update public.people set user_id = ${member.id} where id = ${person}`;
    await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at) values (${c.academy}, ${s[2]!.id}, ${person}, 'booked', now())`;
    const [past] = await adminSql()<{ id: string }[]>`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at, series_id)
      values (${c.academy}, ${c.classTypeId}, now() - interval '2 hours', now() - interval '1 hour', ${s[0]!.series_id}) returning id`;

    const r = await asUser(c.owner, (tx) => schedule.removeSessions(tx, c.academy, s[1]!.id, "following"));
    expect(r).toEqual({ deleted: 2, cancelled: 1 });
    const after = await reload(c.academy);
    expect(after.map((x) => x.id).sort()).toEqual([past!.id, s[0]!.id, s[2]!.id].sort());
    expect(after.find((x) => x.id === s[2]!.id)?.status).toBe("cancelled");
    // La réservation est gardée et l'avis d'annulation est en file pour l'adhérente.
    expect(await adminSql()`select 1 from public.session_bookings where session_id = ${s[2]!.id} and person_id = ${person}`).toHaveLength(1);
    expect(await adminSql()`select 1 from public.booking_notifications n join public.session_bookings b on b.id = n.booking_id where b.session_id = ${s[2]!.id} and n.kind = 'cancelled'`).toHaveLength(1);

    // Une fois annulée (inscrits prévenus), elle peut être supprimée.
    expect(await asUser(c.owner, (tx) => schedule.removeSessions(tx, c.academy, s[2]!.id, "this"))).toEqual({ deleted: 1, cancelled: 0 });
  });

  it("séance seule avec inscrits : annulée, pas supprimée ; séance avec présences : jamais touchée (ni supprimée ni annulée)", async () => {
    const c = await club("sr7");
    const s = await weeklySeries(c);
    const person = await createPerson(c.academy, "Tom", "Inscrit");
    await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${c.academy}, ${s[0]!.id}, ${person}, 'waitlisted')`;
    expect(await asUser(c.owner, (tx) => schedule.removeSessions(tx, c.academy, s[0]!.id, "this"))).toEqual({ deleted: 0, cancelled: 1 });
    const [today] = await adminSql()<{ id: string }[]>`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at)
      values (${c.academy}, ${c.classTypeId}, now() - interval '3 hours', now() - interval '2 hours') returning id`;
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${c.academy}, ${today!.id}, ${person}, 'present')`;
    expect(await asUser(c.owner, (tx) => schedule.removeSessions(tx, c.academy, today!.id, "this"))).toEqual({ deleted: 0, cancelled: 0 });
    expect(await adminSql()`select status from public.sessions where id = ${today!.id}`).toEqual([{ status: "scheduled" }]);
  });

  it("toutes les séances à venir ; un coach ou un autre club ne retirent rien", async () => {
    const c = await club("sr8");
    const s = await weeklySeries(c);
    expect(await asUser(c.coach, (tx) => schedule.removeSessions(tx, c.academy, s[0]!.id, "upcoming"))).toEqual({ deleted: 0, cancelled: 0 });
    const other = await club("sr8b");
    expect(await asUser(other.owner, (tx) => schedule.removeSessions(tx, c.academy, s[0]!.id, "upcoming"))).toEqual({ deleted: 0, cancelled: 0 });
    expect(await reload(c.academy)).toHaveLength(4);
    expect(await asUser(c.owner, (tx) => schedule.removeSessions(tx, c.academy, s[3]!.id, "upcoming"))).toEqual({ deleted: 4, cancelled: 0 });
    expect(await reload(c.academy)).toHaveLength(0);
  });
});
