import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing } from "./support";

/**
 * P1.6 : public des types de cours (all / adults / kids) et âge minimum des cours adultes, réglable par le club (migration 000500).
 */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * 86_400_000 - 30 * 86_400_000).toISOString().slice(0, 10);

async function club(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const [ct] = await adminSql()<{ id: string }[]>`select id from public.class_types where academy_id = ${academy} order by id limit 1`;
  const setAudience = (a: "all" | "adults" | "kids") => adminSql()`update public.class_types set audience = ${a} where id = ${ct!.id}`;
  const setMinAge = (n: number) => adminSql()`update public.academies set adult_class_min_age = ${n} where id = ${academy}`;
  const session = () => createSession(academy, { startsAt: inHours(30) });
  /** Fiche avec date de naissance (mineur) ou sans (majeur). */
  const person = async (name: string, ageYears: number | null) => {
    const id = await createPerson(academy, name, "Test");
    if (ageYears !== null) await adminSql()`update public.people set birth_date = ${yearsAgo(ageYears)}, adult_attested_at = null where id = ${id}`;
    return id;
  };
  const book = (s: string, p: string) => adminSql()<{ r: string }[]>`select app_private.book_person(${s}, ${p}) as r`.then((r) => r[0]!.r);
  return { owner, academy, setAudience, setMinAge, session, person, book };
}

describe("public des cours", () => {
  it("par défaut tout le monde peut réserver ; kids refuse un majeur, adults refuse un mineur (18 ans par défaut)", async () => {
    const c = await club("au1");
    const s = await c.session();
    const adult = await c.person("adulte", null);
    const kid = await c.person("enfant", 12);
    expect(await c.book(s, adult)).toBe("booked");
    expect(await c.book(s, kid)).toBe("booked");

    const kidsOnly = await c.session();
    await c.setAudience("kids");
    expect(await c.book(kidsOnly, kid)).toBe("booked");
    expect((await failing(() => c.book(kidsOnly, adult))).message).toMatch(/audience_not_allowed/);

    const adultsOnly = await c.session();
    await c.setAudience("adults");
    expect(await c.book(adultsOnly, adult)).toBe("booked");
    expect((await failing(() => c.book(adultsOnly, kid))).message).toMatch(/audience_not_allowed/);
  });

  it("l'âge minimum des cours adultes est celui du club : 14 ans, un jeune de 15 ans entre, un de 12 ans non ; pas de baisse sous 10 ni de hausse au-dessus de 18", async () => {
    const c = await club("au2");
    await c.setAudience("adults");
    await c.setMinAge(14);
    const s = await c.session();
    const teen = await c.person("ado", 15);
    const kid = await c.person("petit", 12);
    expect(await c.book(s, teen)).toBe("booked");
    expect((await failing(() => c.book(s, kid))).message).toMatch(/audience_not_allowed/);
    expect((await failing(() => c.setMinAge(9))).message).toMatch(/check|violates/i);
    expect((await failing(() => c.setMinAge(19))).message).toMatch(/check|violates/i);
    // Un enfant qui atteint l'âge réglé entre ; un seuil relevé le referme pour les nouvelles réservations.
    await c.setMinAge(12);
    expect(await c.book(s, kid)).toBe("booked");
  });

  it("changer le public ou le seuil ne retire jamais une réservation déjà prise", async () => {
    const c = await club("au3");
    const s = await c.session();
    const kid = await c.person("petit", 11);
    expect(await c.book(s, kid)).toBe("booked");
    await c.setAudience("adults");
    expect(await c.book(s, kid)).toBe("booked"); // la réservation existante est rendue telle quelle
    expect(await adminSql()`select 1 from public.session_bookings where session_id = ${s} and person_id = ${kid}`).toHaveLength(1);
  });

  it("chemin adhérent : un majeur est refusé par book_session sur un cours « Enfants »", async () => {
    const c = await club("au4");
    const member = await createUser("au4-m");
    await addMember(c.academy, member, "member");
    await asUser(member, (tx) => tx`select public.ensure_my_member_record(${c.academy})`);
    const s = await c.session();
    await c.setAudience("kids");
    const err = await failing(() => asUser(member, (tx) => tx`select public.book_session(${s})`));
    expect(err.message).toBeTruthy();
    expect(await adminSql()`select 1 from public.session_bookings where session_id = ${s}`).toHaveLength(0);

    // La liste affiche le public refusé (le bouton « Réserver » est masqué) ; un cours « Tous » n'a rien à signaler.
    const open = await createSession(c.academy, { startsAt: inHours(40) });
    await adminSql()`update public.sessions set class_type_id = (select id from public.class_types where academy_id = ${c.academy} order by id limit 1 offset 1) where id = ${open} and exists (select 1 from public.class_types where academy_id = ${c.academy} offset 1)`;
    const rows = await asUser(member, (tx) => tx<{ session_id: string; denied_audience: string | null }[]>`
      select session_id, denied_audience from public.session_bookings_overview(${c.academy}, now(), now() + interval '3 days')`);
    expect(rows.find((r) => r.session_id === s)?.denied_audience).toBe("kids");
  });

  it("seul un administrateur règle le public d'un cours et l'âge minimum du club ; l'audit signale le changement", async () => {
    const c = await club("au5");
    const coach = await createUser("au5-coach");
    await addMember(c.academy, coach, "coach");
    const [ct] = await adminSql()<{ id: string }[]>`select id from public.class_types where academy_id = ${c.academy} limit 1`;

    await asUser(c.owner, (tx) => tx`update public.class_types set audience = 'kids' where id = ${ct!.id}`);
    await asUser(c.owner, (tx) => tx`update public.academies set adult_class_min_age = 16 where id = ${c.academy}`);
    const [row] = await adminSql()`select adult_class_min_age from public.academies where id = ${c.academy}`;
    expect(row!.adult_class_min_age).toBe(16);
    const [audit] = await adminSql()`select metadata from public.audit_events where academy_id = ${c.academy} and action = 'academy.settings_updated' order by id desc limit 1`;
    expect(audit!.metadata).toMatchObject({ adult_class_min_age_changed: true });

    // Un coach ne change rien : la mise à jour ne touche aucune ligne (RLS).
    const r1 = await asUser(coach, (tx) => tx`update public.class_types set audience = 'adults' where id = ${ct!.id}`);
    const r2 = await asUser(coach, (tx) => tx`update public.academies set adult_class_min_age = 10 where id = ${c.academy}`);
    expect(r1.count).toBe(0);
    expect(r2.count).toBe(0);
    const [after] = await adminSql()`select ct.audience, a.adult_class_min_age from public.class_types ct join public.academies a on a.id = ct.academy_id where ct.id = ${ct!.id}`;
    expect(after).toMatchObject({ audience: "kids", adult_class_min_age: 16 });
  });

  it("un autre club n'est pas touché par les réglages du premier", async () => {
    const a = await club("au6a");
    const b = await club("au6b");
    await a.setMinAge(12);
    await a.setAudience("kids");
    const [other] = await adminSql()`select a.adult_class_min_age, ct.audience from public.academies a join public.class_types ct on ct.academy_id = a.id where a.id = ${b.academy} limit 1`;
    expect(other).toMatchObject({ adult_class_min_age: 18, audience: "all" });
  });
});
