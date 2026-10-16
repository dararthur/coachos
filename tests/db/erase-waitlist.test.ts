import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser } from "./support";

/** P1.6 : effacer une fiche (suppression ou anonymisation) fait avancer la liste d'attente ; ceinture modifiable par l'admin seulement. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function fullClass(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const session = await createSession(academy, { startsAt: inHours(30) });
  await adminSql()`update public.sessions set capacity = 1 where id = ${session}`;
  const person = async (name: string) => {
    const user = await createUser(`${label}-${name}`);
    await addMember(academy, user, "member");
    const id = await createPerson(academy, name, "Test");
    await adminSql()`update public.people set user_id = ${user.id} where id = ${id}`;
    return { user, id };
  };
  const first = await person("first");
  const next = await person("next");
  await asUser(first.user, (tx) => tx`select public.book_session(${session})`);
  await asUser(next.user, (tx) => tx`select public.book_session(${session})`);
  await adminSql()`delete from public.booking_notifications`;
  const statusOf = async (id: string) =>
    (await adminSql()<{ status: string }[]>`select status from public.session_bookings where session_id = ${session} and person_id = ${id}`)[0]?.status ?? null;
  return { owner, academy, session, first, next, statusOf };
}

describe("effacement d'une fiche et liste d'attente", () => {
  it("la SUPPRESSION d'un inscrit promeut le premier de la liste d'attente et le fait prévenir", async () => {
    const c = await fullClass("ew1");
    expect(await c.statusOf(c.next.id)).toBe("waitlisted");
    await asUser(c.owner, (tx) => tx`select public.erase_person(${c.first.id}, 'delete')`);
    expect(await c.statusOf(c.next.id)).toBe("booked");
    const queued = await adminSql()<{ kind: string }[]>`select kind from public.booking_notifications`;
    expect(queued.map((q) => q.kind)).toEqual(["promoted"]);
  });

  it("l'ANONYMISATION fait de même (comportement conservé)", async () => {
    const c = await fullClass("ew2");
    await asUser(c.owner, (tx) => tx`select public.erase_person(${c.first.id}, 'anonymize')`);
    expect(await c.statusOf(c.next.id)).toBe("booked");
  });

  it("supprimer quelqu'un de la liste d'attente ou sans réservation ne promeut personne", async () => {
    const c = await fullClass("ew3");
    await asUser(c.owner, (tx) => tx`select public.erase_person(${c.next.id}, 'delete')`);
    expect(await c.statusOf(c.first.id)).toBe("booked");
    expect(await adminSql()`select 1 from public.booking_notifications`).toHaveLength(0);
  });

  it("seul un administrateur du club efface une fiche ; l'autre club n'est pas touché", async () => {
    const c = await fullClass("ew4");
    const other = await fullClass("ew5");
    const stranger = other.owner;
    await expect(asUser(stranger, (tx) => tx`select public.erase_person(${c.first.id}, 'delete')`)).rejects.toThrow();
    expect(await c.statusOf(c.first.id)).toBe("booked");
    expect(await other.statusOf(other.first.id)).toBe("booked");
  });
});

describe("ceinture : modifiable par l'administrateur du club seulement", () => {
  it("un admin change ceinture et barrettes ; un coach, un membre ou l'admin d'un autre club n'y arrivent pas", async () => {
    const owner = await createUser("bt-owner");
    const academy = await createAcademy(owner, "Club Ceinture");
    const coach = await createUser("bt-coach");
    await addMember(academy, coach, "coach");
    const member = await createUser("bt-member");
    await addMember(academy, member, "member");
    const stranger = await createUser("bt-stranger");
    await createAcademy(stranger, "Club Autre");
    const person = await createPerson(academy, "Ana", "Ceinture");

    const read = async () => (await adminSql()<{ belt: string | null; belt_stripes: number }[]>`select belt, belt_stripes from public.people where id = ${person}`)[0]!;

    await asUser(owner, (tx) => tx`update public.people set belt = 'blue', belt_stripes = 2 where id = ${person}`);
    expect(await read()).toEqual({ belt: "blue", belt_stripes: 2 });

    for (const who of [coach, member, stranger]) {
      const r = await asUser(who, (tx) => tx`update public.people set belt = 'black', belt_stripes = 4 where id = ${person}`).catch(() => ({ count: 0 }));
      expect(r.count).toBe(0);
    }
    expect(await read()).toEqual({ belt: "blue", belt_stripes: 2 });
  });
});
