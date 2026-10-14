import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createSession, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const bookingsOf = (session: string) =>
  adminSql()<{ user_id: string | null; status: string; is_instructor: boolean }[]>`
    select p.user_id, b.status, b.is_instructor from public.session_bookings b join public.people p on p.id = b.person_id where b.session_id = ${session}`;

describe("coach affecté : inscrit d'office à ses séances", () => {
  it("la séance créée avec un coach lui crée une fiche et une réservation confirmée, même au-delà de la capacité", async () => {
    const owner = await createUser("cm-owner");
    const academy = await createAcademy(owner, "Club Coach");
    const coach = await createUser("cm-coach");
    await addMember(academy, coach, "coach");
    expect(await adminSql()`select 1 from public.people where academy_id = ${academy} and user_id = ${coach.id}`).toHaveLength(0);

    const session = await createSession(academy, { instructor: coach.id });
    expect(await bookingsOf(session)).toEqual([{ user_id: coach.id, status: "booked", is_instructor: true }]);

    // Capacité 1 et un adhérent déjà inscrit : le coach reste « inscrit » (il n'est jamais mis en liste d'attente).
    const full = await createSession(academy, { instructor: null });
    await adminSql()`update public.sessions set capacity = 1 where id = ${full}`;
    const member = await createUser("cm-member");
    await addMember(academy, member, "member");
    await asUser(member, (tx) => tx`select public.ensure_my_member_record(${academy})`);
    await asUser(member, (tx) => tx`select public.book_session(${full})`);
    await adminSql()`update public.sessions set instructor_id = ${coach.id} where id = ${full}`;
    const rows = await bookingsOf(full);
    expect(rows.find((r) => r.user_id === coach.id)).toEqual({ user_id: coach.id, status: "booked", is_instructor: true });
  });

  it("changer de coach retire l'inscription d'office de l'ancien (sauf présence) et inscrit le nouveau", async () => {
    const owner = await createUser("cm2-owner");
    const academy = await createAcademy(owner, "Club Changement");
    const a = await createUser("cm2-a");
    const b = await createUser("cm2-b");
    await addMember(academy, a, "coach");
    await addMember(academy, b, "coach");
    const session = await createSession(academy, { instructor: a.id });
    await adminSql()`update public.sessions set instructor_id = ${b.id} where id = ${session}`;
    expect((await bookingsOf(session)).map((r) => r.user_id)).toEqual([b.id]);

    // L'ancien coach a déjà une présence enregistrée : sa réservation est conservée.
    const kept = await createSession(academy, { instructor: a.id });
    const [pa] = await adminSql()<{ id: string }[]>`select id from public.people where academy_id = ${academy} and user_id = ${a.id}`;
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${kept}, ${pa!.id}, 'present')`;
    await adminSql()`update public.sessions set instructor_id = ${b.id} where id = ${kept}`;
    expect((await bookingsOf(kept)).map((r) => r.user_id).sort()).toEqual([a.id, b.id].sort());

    // Retirer le coach : plus aucune inscription d'office.
    await adminSql()`update public.sessions set instructor_id = null where id = ${session}`;
    expect(await bookingsOf(session)).toEqual([]);
  });

  it("une séance annulée n'inscrit personne", async () => {
    const owner = await createUser("cm3-owner");
    const academy = await createAcademy(owner, "Club Annulée");
    const coach = await createUser("cm3-coach");
    await addMember(academy, coach, "coach");
    const session = await createSession(academy, { instructor: coach.id, status: "cancelled" });
    expect(await bookingsOf(session)).toEqual([]);
  });
});

describe("mode membre de l'équipe", () => {
  it("un coach crée sa fiche d'adhérent (idempotent) puis réserve une autre séance ; un étranger au club est refusé", async () => {
    const owner = await createUser("mm-owner");
    const academy = await createAcademy(owner, "Club Mode");
    const coach = await createUser("mm-coach");
    await addMember(academy, coach, "coach");
    const other = await createSession(academy, { instructor: null });

    const first = await asUser(coach, (tx) => tx<{ id: string }[]>`select public.ensure_my_member_record(${academy}) as id`);
    const second = await asUser(coach, (tx) => tx<{ id: string }[]>`select public.ensure_my_member_record(${academy}) as id`);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect((await asUser(coach, (tx) => tx<{ s: string }[]>`select public.book_session(${other}) as s`))[0]!.s).toBe("booked");
    expect(await bookingsOf(other)).toEqual([{ user_id: coach.id, status: "booked", is_instructor: false }]);

    const stranger = await createUser("mm-stranger");
    expect((await failing(() => asUser(stranger, (tx) => tx`select public.ensure_my_member_record(${academy})`))).message).toContain("coachos:not_found");
  });
});
