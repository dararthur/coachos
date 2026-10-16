import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDueRolls } from "@/server/roll-closure";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

/** Début d'une séance d'une heure se terminant à 23:30 (heure du club) la veille, ou `daysAgo` jours avant. */
async function endedAtLocal2330(timezone: string, daysAgo = 1): Promise<string> {
  const [row] = await adminSql()<{ s: string }[]>`
    select (((date_trunc('day', now() at time zone ${timezone}) - make_interval(days => ${daysAgo - 1})) - interval '30 minutes' - interval '1 hour') at time zone ${timezone})::text as s`;
  return row!.s;
}
/** Séance qui finit 30 minutes après minuit, le jour local courant : jamais clôturable avant le prochain minuit. */
async function endedAfterMidnightToday(timezone: string): Promise<string> {
  const [row] = await adminSql()<{ s: string }[]>`
    select ((date_trunc('day', now() at time zone ${timezone}) - interval '30 minutes') at time zone ${timezone})::text as s`;
  return row!.s;
}

async function club(label: string, timezone = "Europe/Paris") {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  if (timezone !== "Europe/Paris") await adminSql()`update public.academies set timezone = ${timezone} where id = ${academy}`;
  const coach = await createUser(`${label}-coach`);
  await addMember(academy, coach, "coach");
  const person = async (name: string) => createPerson(academy, name, "Test");
  const book = (session: string, personId: string) =>
    adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${personId}, 'booked')`;
  const sheet = async (session: string) =>
    (await adminSql()<{ validated_at: Date | null; validated_by: string | null; validated_auto: boolean; status: string }[]>`
      select validated_at, validated_by, validated_auto, status from public.session_checkins where session_id = ${session}`)[0];
  const attendance = async (session: string) =>
    adminSql()<{ person_id: string; status: string }[]>`select person_id, status from public.attendance where session_id = ${session} order by status`;
  return { owner, academy, coach, person, book, sheet, attendance };
}

describe("clôture automatique des feuilles d'appel", () => {
  it("clôture la séance d'hier : inscrits sans présence absents, coach affecté présent, présence déjà saisie conservée", async () => {
    const c = await club("ac1");
    const session = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris"), instructor: c.coach.id });
    const ana = await c.person("ana");
    const bob = await c.person("bob");
    await c.book(session, ana);
    await c.book(session, bob);
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${c.academy}, ${session}, ${bob}, 'late')`;

    await closeDueRolls({ sql: appSql() });

    expect(await c.sheet(session)).toMatchObject({ status: "closed", validated_by: null, validated_auto: true });
    const rows = await c.attendance(session);
    expect(rows.find((r) => r.person_id === ana)?.status).toBe("absent");
    expect(rows.find((r) => r.person_id === bob)?.status).toBe("late");
    expect(rows.filter((r) => r.status === "present")).toHaveLength(1); // le coach
    const [audit] = await adminSql()`select actor_user_id, metadata from public.audit_events where entity_id = ${session} and action = 'roll.auto_closed'`;
    expect(audit).toMatchObject({ actor_user_id: null, metadata: { no_shows: 1 } });
  });

  it("est idempotente : un second passage ne touche à rien et n'écrit pas d'audit supplémentaire", async () => {
    const c = await club("ac2");
    const session = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris") });
    await c.book(session, await c.person("ana"));
    await closeDueRolls({ sql: appSql() });
    const again = await closeDueRolls({ sql: appSql() });
    expect(again).toMatchObject({ failed: 0 });
    expect(await adminSql()`select 1 from public.audit_events where entity_id = ${session} and action = 'roll.auto_closed'`).toHaveLength(1);
    expect(await c.attendance(session)).toHaveLength(1);
  });

  it("respecte le fuseau du club, pas celui du serveur", async () => {
    for (const tz of ["Pacific/Auckland", "America/Los_Angeles", "Europe/Paris"]) {
      const c = await club(`ac3${tz.length}`, tz);
      const yesterday = await createSession(c.academy, { startsAt: await endedAtLocal2330(tz) });
      const tonight = await createSession(c.academy, { startsAt: await endedAfterMidnightToday(tz) });
      await closeDueRolls({ sql: appSql() });
      expect((await c.sheet(yesterday))?.validated_auto, tz).toBe(true);
      expect(await c.sheet(tonight), tz).toBeUndefined();
    }
  });

  it("ne clôture ni une séance annulée, ni une feuille déjà validée par un coach, ni l'historique de plus de 3 jours", async () => {
    const c = await club("ac4");
    const cancelled = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris"), status: "cancelled" });
    const manual = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris"), instructor: c.coach.id });
    await asUser(c.coach, (tx) => tx`select public.roll_set_validated(${manual}, true)`);
    const old = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris", 5) });
    await c.book(old, await c.person("vieux"));

    await closeDueRolls({ sql: appSql() });

    expect(await c.sheet(cancelled)).toBeUndefined();
    expect(await c.sheet(manual)).toMatchObject({ validated_by: c.coach.id, validated_auto: false });
    expect(await c.sheet(old)).toBeUndefined();
    expect(await c.attendance(old)).toHaveLength(0);
  });

  it("clôt une séance sans inscrit (aucune absence) et ne bloque pas les autres si l'une échoue", async () => {
    const c = await club("ac5");
    const empty = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris") });
    const result = await closeDueRolls({ sql: appSql() });
    expect(result.failed).toBe(0);
    expect(await c.sheet(empty)).toMatchObject({ validated_auto: true });
    expect(await c.attendance(empty)).toHaveLength(0);
  });

  it("la feuille clôturée se rouvre, se corrige, puis se valide à la main : le marquage automatique disparaît", async () => {
    const c = await club("ac6");
    const session = await createSession(c.academy, { startsAt: await endedAtLocal2330("Europe/Paris"), instructor: c.coach.id });
    const ana = await c.person("ana");
    await c.book(session, ana);
    await closeDueRolls({ sql: appSql() });
    expect((await c.sheet(session))?.validated_auto).toBe(true);

    await asUser(c.coach, (tx) => tx`select public.roll_set_validated(${session}, false)`);
    expect(await c.sheet(session)).toMatchObject({ validated_at: null, validated_auto: false });
    await asUser(c.coach, (tx) => tx`update public.attendance set status = 'present' where session_id = ${session} and person_id = ${ana}`);
    await asUser(c.coach, (tx) => tx`select public.roll_set_validated(${session}, true)`);
    expect(await c.sheet(session)).toMatchObject({ validated_by: c.coach.id, validated_auto: false });
    expect((await c.attendance(session)).find((r) => r.person_id === ana)?.status).toBe("present");
  });

  it("n'est exécutable que par le service : ni un utilisateur connecté, ni un anonyme", async () => {
    const c = await club("ac7");
    expect((await failing(() => asUser(c.owner, (tx) => tx`select app_private.close_due_rolls()`))).message).toMatch(/permission denied/i);
    expect((await failing(() => asUser(c.owner, (tx) => tx`select app_private.roll_apply_validation(${crypto.randomUUID()}, null, true)`))).message).toMatch(/permission denied/i);
  });
});
