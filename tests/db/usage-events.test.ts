import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDueRolls } from "@/server/roll-closure";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const events = (academy: string) =>
  adminSql()<{ event: string }[]>`select event from public.usage_events where academy_id = ${academy} order by id`.then((r) => r.map((x) => x.event));

describe("mesure d'usage", () => {
  it("enregistre réservation, pointage QR et validation, sans aucun identifiant de personne", async () => {
    const owner = await createUser("us-owner");
    const academy = await createAcademy(owner, "Club Usage");
    const coach = await createUser("us-coach");
    await addMember(academy, coach, "coach");
    const person = await createPerson(academy, "Ana", "Test");
    const session = await createSession(academy, { instructor: coach.id });

    await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${person}, 'booked')`;
    // Le coach affecté (inscrit d'office) ne compte pas comme une réservation de membre.
    expect(await events(academy)).toEqual(["booking_created"]);

    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${person}, 'present')`;
    expect(await events(academy)).toEqual(["booking_created"]); // saisie manuelle : pas un pointage QR

    const other = await createPerson(academy, "Bob", "Test");
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status, source) values (${academy}, ${session}, ${other}, 'present', 'qr')`;
    expect(await events(academy)).toEqual(["booking_created", "checkin_qr"]);

    await asUser(coach, (tx) => tx`select public.roll_set_validated(${session}, true)`);
    await asUser(coach, (tx) => tx`select public.roll_set_validated(${session}, true)`); // revalidation : pas de doublon
    expect((await events(academy)).filter((e) => e === "roll_validated")).toHaveLength(1);

    const [row] = await adminSql()`select * from public.usage_events where academy_id = ${academy} limit 1`;
    expect(Object.keys(row!).sort()).toEqual(["academy_id", "created_at", "event", "id"]);
  });

  it("compte la clôture automatique à part", async () => {
    const owner = await createUser("us2-owner");
    const academy = await createAcademy(owner, "Club Usage 2");
    await createSession(academy, { startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await closeDueRolls({ sql: appSql() });
    expect(await events(academy)).toEqual(["roll_auto_closed"]);
  });

  it("n'est lisible que par les administrateurs du club, jamais d'un autre club, jamais en écriture", async () => {
    const o1 = await createUser("us3-o1");
    const o2 = await createUser("us3-o2");
    const a1 = await createAcademy(o1, "Club U3a");
    await createAcademy(o2, "Club U3b");
    const member = await createUser("us3-m");
    await addMember(a1, member, "member");
    await adminSql()`insert into public.usage_events (academy_id, event) values (${a1}, 'booking_created')`;
    expect(await asUser(o1, (tx) => tx`select 1 from public.usage_events where academy_id = ${a1}`)).toHaveLength(1);
    expect(await asUser(o2, (tx) => tx`select 1 from public.usage_events where academy_id = ${a1}`)).toHaveLength(0);
    expect(await asUser(member, (tx) => tx`select 1 from public.usage_events`)).toHaveLength(0);
    await expect(asUser(o1, (tx) => tx`insert into public.usage_events (academy_id, event) values (${a1}, 'booking_created')`)).rejects.toThrow(/droits nécessaires/);
  });

  it("la purge supprime ce qui a plus de 13 mois, et seulement cela", async () => {
    const owner = await createUser("us4-owner");
    const academy = await createAcademy(owner, "Club U4");
    await adminSql()`insert into public.usage_events (academy_id, event, created_at) values (${academy}, 'booking_created', now() - interval '14 months'), (${academy}, 'booking_created', now() - interval '12 months')`;
    await appSql()`select app_private.purge_usage_events()`;
    expect(await events(academy)).toHaveLength(1);
  });
});
