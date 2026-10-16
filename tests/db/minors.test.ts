import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createSession, createUser, failing, type World } from "./support";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const yearsAgo = (n: number) => new Date(Date.now() - n * 365.25 * 86_400_000).toISOString().slice(0, 10);

async function createMinor(user: { id: string }, token = randomBytes(16).toString("hex"), age = 12) {
  const [r] = await asUser(user, (tx) => tx<{ id: string }[]>`
    select public.create_minor_member(${w.academyA}, 'Léo', 'Petit', ${yearsAgo(age)}::date, null, null,
      'Parent Petit', ${`parent-${token.slice(0, 6)}@example.invalid`}, null, ${hash(token)}) as id`);
  return { id: r!.id, token };
}

describe("adhérents mineurs", () => {
  it("le staff crée un mineur avec son responsable ; classement et photo restent désactivés", async () => {
    const { id } = await createMinor(w.carl);
    const [p] = await adminSql()<{ birth_date: string | null; adult_attested_at: Date | null; ranking_opt_in: boolean }[]>`
      select birth_date::text, adult_attested_at, ranking_opt_in from public.people where id = ${id}`;
    expect(p?.birth_date).not.toBeNull();
    expect(p?.adult_attested_at).toBeNull();
    expect(p?.ranking_opt_in).toBe(false);
    const [g] = await adminSql()`select consent_confirmed_at, consent_expires_at from public.guardianships where child_id = ${id}`;
    expect(g?.consent_confirmed_at).toBeNull();
  });

  it("le staff crée un adulte directement sous RLS (les déclencheurs ne demandent aucun droit à l'appelant)", async () => {
    const [p] = await asUser(w.carl, (tx) => tx<{ id: string; a: Date | null }[]>`insert into public.people (academy_id, first_name, last_name) values (${w.academyA}, 'Direct', 'Adulte') returning id, adult_attested_at as a`);
    expect(p?.a).not.toBeNull();
  });

  it("refuse un mineur sans responsable, un adulte via create_minor_member et un membre simple", async () => {
    const err = await failing(() => adminSql()`insert into public.people (academy_id, first_name, last_name, birth_date)
      values (${w.academyA}, 'Sans', 'Parent', ${yearsAgo(10)}::date)`);
    expect(err.message).toContain("guardian_required");
    const adult = await failing(() => asUser(w.carl, (tx) => tx`select public.create_minor_member(${w.academyA}, 'A', 'B', ${yearsAgo(30)}::date, null, null, 'P', 'p@example.invalid', null, ${hash("x")})`));
    expect(adult.message).toContain("not_minor");
    const member = await failing(() => asUser(w.mia, (tx) => tx`select public.create_minor_member(${w.academyA}, 'A', 'B', ${yearsAgo(10)}::date, null, null, 'P', 'p@example.invalid', null, ${hash("y")})`));
    expect(member.message).toContain("not_found");
  });

  it("la date de naissance d'un majeur saisi par le staff n'est pas conservée", async () => {
    const [p] = await adminSql()<{ id: string }[]>`insert into public.people (academy_id, first_name, last_name, birth_date)
      values (${w.academyA}, 'Grand', 'Adulte', ${yearsAgo(30)}::date) returning id`;
    const [row] = await adminSql()<{ birth_date: string | null; adult_attested_at: Date | null }[]>`select birth_date::text, adult_attested_at from public.people where id = ${p!.id}`;
    expect(row?.birth_date).toBeNull();
    expect(row?.adult_attested_at).not.toBeNull();
  });

  it("l'adresse du responsable légal ouvre l'inscription (sans code de club) tant que l'accord n'est pas retiré", async () => {
    const { id, token } = await createMinor(w.carl);
    const guardian = `parent-${token.slice(0, 6)}@example.invalid`;
    const allowed = async (e: string) => (await appSql()<{ ok: boolean }[]>`select app_private.signup_email_allowed(${e}) as ok`)[0]!.ok;
    expect(await allowed(guardian)).toBe(true);
    expect(await allowed(` ${guardian.toUpperCase()} `)).toBe(true);
    expect(await allowed(`autre-${token.slice(0, 6)}@example.invalid`)).toBe(false);
    await adminSql()`update public.guardianships set consent_withdrawn_at = now() where child_id = ${id}`;
    expect(await allowed(guardian)).toBe(false);
  });

  it("le lien confirme l'accord une fois, expire et se rattache à un compte sans l'écraser", async () => {
    const { id, token } = await createMinor(w.carl);
    const parent = await createUser("parent-a");
    const other = await createUser("parent-b");
    const confirm = (t: string, u: string | null) => appSql()<{ child_first_name: string | null; academy_name: string | null; state: string }[]>`
      select * from app_private.confirm_guardian_consent(${hash(t)}, ${u})`;
    expect((await confirm("inconnu", null))[0]?.state).toBe("invalid");
    expect((await confirm(token, null))[0]).toMatchObject({ child_first_name: "Léo", state: "confirmed" });
    expect((await confirm(token, parent.id))[0]?.state).toBe("already");
    await confirm(token, other.id);
    const [g] = await adminSql()<{ guardian_user_id: string }[]>`select guardian_user_id from public.guardianships where child_id = ${id}`;
    expect(g?.guardian_user_id).toBe(parent.id);
    await adminSql()`update public.guardianships set consent_expires_at = now() - interval '1 minute' where child_id = ${id}`;
    expect((await confirm(token, null))[0]?.state).toBe("invalid");
  });

  it("le responsable gère le classement de son enfant seulement après accord ; un tiers n'y a pas accès", async () => {
    const { id, token } = await createMinor(w.carl);
    const parent = await createUser("parent-c");
    const stranger = await createUser("stranger");
    const toggle = (u: { id: string }, v: boolean) => asUser(u, (tx) => tx`select public.set_child_ranking_visibility(${id}, ${v})`);
    await adminSql()`update public.guardianships set guardian_user_id = ${parent.id} where child_id = ${id}`;
    expect((await failing(() => toggle(parent, true))).message).toContain("consent_required");
    await appSql()`select * from app_private.confirm_guardian_consent(${hash(token)}, ${parent.id})`;
    await toggle(parent, true);
    expect((await adminSql()`select ranking_opt_in from public.people where id = ${id}`)[0]?.ranking_opt_in).toBe(true);
    expect((await failing(() => toggle(stranger, true))).message).toContain("not_found");
    expect(await asUser(stranger, (tx) => tx`select * from public.my_children()`)).toHaveLength(0);
    expect(await asUser(parent, (tx) => tx`select * from public.my_children()`)).toHaveLength(1);
    // le trigger refuse aussi une écriture directe sans accord confirmé
    const other = await createMinor(w.carl);
    await adminSql()`update public.people set ranking_opt_in = true where id = ${other.id}`;
    expect((await adminSql()`select ranking_opt_in from public.people where id = ${other.id}`)[0]?.ranking_opt_in).toBe(false);
  });

  it("le retrait de l'accord archive la fiche, coupe le classement et supprime la photo", async () => {
    const { id, token } = await createMinor(w.carl);
    const parent = await createUser("parent-d");
    await appSql()`select * from app_private.confirm_guardian_consent(${hash(token)}, ${parent.id})`;
    await adminSql()`update public.people set ranking_opt_in = true where id = ${id}`;
    // état hérité : une photo posée avant la règle (le déclencheur la refuserait aujourd'hui)
    await adminSql()`alter table public.person_photos disable trigger person_photos_minor_guard`;
    await adminSql()`insert into public.person_photos (person_id, academy_id, content_type, data) values (${id}, ${w.academyA}, 'image/png', ${Buffer.from([0x89, 0x50, 0x4e, 0x47])})`;
    await adminSql()`alter table public.person_photos enable trigger person_photos_minor_guard`;
    await asUser(parent, (tx) => tx`select public.withdraw_guardian_consent(${id})`);
    const [p] = await adminSql()<{ archived_at: Date | null; ranking_opt_in: boolean }[]>`select archived_at, ranking_opt_in from public.people where id = ${id}`;
    expect(p?.archived_at).not.toBeNull();
    expect(p?.ranking_opt_in).toBe(false);
    expect(await adminSql()`select 1 from public.person_photos where person_id = ${id}`).toHaveLength(0);
    expect((await appSql()<{ state: string }[]>`select state from app_private.confirm_guardian_consent(${hash(token)}, null)`)[0]?.state).toBe("invalid");
  });

  it("le staff voit le responsable, un membre non ; l'export de la fiche l'inclut", async () => {
    const { id } = await createMinor(w.carl);
    expect(await asUser(w.carl, (tx) => tx`select 1 from public.guardianships where child_id = ${id}`)).toHaveLength(1);
    expect(await asUser(w.mia, (tx) => tx`select 1 from public.guardianships where child_id = ${id}`)).toHaveLength(0);
    const [e] = await asUser(w.adam, (tx) => tx<{ d: { person: { birth_date: string }; guardian: { name: string } } }[]>`select public.export_person_data(${id}) as d`);
    expect(e?.d.person.birth_date).toBeTruthy();
    expect(e?.d.guardian.name).toBe("Parent Petit");
  });

  it("l'effacement et la majorité font disparaître date de naissance et responsable", async () => {
    const a = await createMinor(w.carl);
    await asUser(w.adam, (tx) => tx`select public.erase_person(${a.id}, 'anonymize')`);
    expect(await adminSql()`select 1 from public.guardianships where child_id = ${a.id}`).toHaveLength(0);
    expect((await adminSql()`select birth_date from public.people where id = ${a.id}`)[0]?.birth_date).toBeNull();

    const b = await createMinor(w.carl, undefined, 17);
    await adminSql()`update public.people set birth_date = ${yearsAgo(19)}::date where id = ${b.id}`;
    await appSql()`select app_private.graduate_minors()`;
    const [p] = await adminSql()<{ birth_date: string | null; adult_attested_at: Date | null }[]>`select birth_date::text, adult_attested_at from public.people where id = ${b.id}`;
    expect(p?.birth_date).toBeNull();
    expect(p?.adult_attested_at).not.toBeNull();
    expect(await adminSql()`select 1 from public.guardianships where child_id = ${b.id}`).toHaveLength(0);
    const c = await createMinor(w.carl);
    await asUser(w.adam, (tx) => tx`select public.erase_person(${c.id}, 'delete')`);
    expect(await adminSql()`select 1 from public.guardianships where child_id = ${c.id}`).toHaveLength(0);
  });
});

describe("ceintures enfants IBJJF", () => {
  it("la base accepte les ceintures enfants et refuse une ceinture inconnue", async () => {
    const [p] = await adminSql()<{ id: string }[]>`insert into public.people (academy_id, first_name, last_name) values (${w.academyA}, 'Kid', 'Belt') returning id`;
    for (const belt of ["grey_white", "yellow", "orange_black", "green"]) {
      await adminSql()`update public.people set belt = ${belt} where id = ${p!.id}`;
    }
    await expect(adminSql()`update public.people set belt = 'pink' where id = ${p!.id}`).rejects.toThrow();
  });
});

describe("compte propre d'un mineur de 15 ans et plus", () => {
  async function consentedChild(age: number) {
    const { id, token } = await createMinor(w.carl, undefined, age);
    const parent = await createUser(`parent-own-${randomBytes(3).toString("hex")}`);
    await appSql()`select * from app_private.confirm_guardian_consent(${hash(token)}, ${parent.id})`;
    return { id, parent };
  }
  const invite = (u: { id: string }, child: string, email: string, t = randomBytes(16).toString("hex")) =>
    asUser(u, (tx) => tx`select public.invite_minor_account(${child}, ${email}, ${hash(t)})`).then(() => t);

  it("exige l'accord confirmé, 15 ans révolus et un responsable ou administrateur", async () => {
    const young = await consentedChild(13);
    expect((await failing(() => invite(young.parent, young.id, "ado@example.invalid"))).message).toContain("minor_too_young");
    const teen = await consentedChild(16);
    expect((await failing(() => invite(w.mia, teen.id, "ado@example.invalid"))).message).toContain("not_found");
    const pending = await createMinor(w.carl, undefined, 16);
    expect((await failing(() => invite(w.adam, pending.id, "ado@example.invalid"))).message).toContain("consent_required");
    await invite(teen.parent, teen.id, "ado@example.invalid");
  });

  it("le mineur accepte l'invitation, valide son profil sans attester sa majorité, et ne peut ni classement ni photo", async () => {
    const { id, parent } = await consentedChild(16);
    const teen = await createUser("teen-own");
    const token = await invite(parent, id, "ado2@example.invalid");
    await adminSql()`update auth.users set email = 'ado2@example.invalid' where id = ${teen.id}`;
    await asUser(teen, (tx) => tx`select public.accept_invitation(${hash(token)})`);
    const [p] = await adminSql()<{ user_id: string | null; adult_attested_at: Date | null; birth_date: string | null }[]>`select user_id, adult_attested_at, birth_date::text from public.people where id = ${id}`;
    expect(p?.user_id).toBe(teen.id);
    expect(await adminSql()`select 1 from public.people where user_id = ${teen.id}`).toHaveLength(1);
    await asUser(teen, (tx) => tx`select public.update_my_profile(${w.academyA}, 'Léo', 'Petit', null, 'blue', 0, 'neutral', false)`);
    const [after] = await adminSql()<{ adult_attested_at: Date | null; birth_date: string | null; profile_completed_at: Date | null }[]>`select adult_attested_at, birth_date::text, profile_completed_at from public.people where id = ${id}`;
    expect(after?.adult_attested_at).toBeNull();
    expect(after?.birth_date).not.toBeNull();
    expect(after?.profile_completed_at).not.toBeNull();
    expect((await failing(() => asUser(teen, (tx) => tx`select public.set_my_ranking_visibility(${w.academyA}, true)`))).message).toContain("guardian_required");
    expect((await failing(() => asUser(teen, (tx) => tx`select public.set_my_photo(${w.academyA}, 'image/png', ${Buffer.from([1, 2, 3])})`))).message).toContain("guardian_required");
    // le parent garde la main sur le classement
    await asUser(parent, (tx) => tx`select public.set_child_ranking_visibility(${id}, true)`);
    expect((await adminSql()`select ranking_opt_in from public.people where id = ${id}`)[0]?.ranking_opt_in).toBe(true);
    // retrait de l'accord : compte délié, appartenance retirée
    await asUser(parent, (tx) => tx`select public.withdraw_guardian_consent(${id})`);
    expect((await adminSql()`select user_id from public.people where id = ${id}`)[0]?.user_id).toBeNull();
    expect(await adminSql()`select 1 from public.academy_memberships where user_id = ${teen.id}`).toHaveLength(0);
  });

  it("l'invitation d'équipe classique ne peut pas lier un compte à une fiche de mineur", async () => {
    const { id } = await consentedChild(16);
    const err = await failing(() => asUser(w.adam, (tx) => tx`select public.create_invitation(${w.academyA}, 'x@example.invalid', 'member', ${id}, ${hash("zz")})`));
    expect(err.message).toContain("invalid_person");
  });
});

describe("le responsable réserve les cours de son enfant", () => {
  async function consentedChild(age = 10) {
    const { id, token } = await createMinor(w.carl, undefined, age);
    const parent = await createUser(`parent-book-${randomBytes(3).toString("hex")}`);
    await appSql()`select * from app_private.confirm_guardian_consent(${hash(token)}, ${parent.id})`;
    return { id, parent };
  }

  it("réserve, voit son enfant inscrit, passe en liste d'attente quand c'est complet, annule", async () => {
    const { id, parent } = await consentedChild();
    const session = await createSession(w.academyA);
    const sessions = () => asUser(parent, (tx) => tx<{ session_id: string; child_status: string | null; booked: number }[]>`select session_id, child_status, booked from public.child_sessions(${id})`);
    expect((await sessions()).find((s) => s.session_id === session)?.child_status).toBeNull();
    expect((await asUser(parent, (tx) => tx<{ s: string }[]>`select public.book_for_child(${session}, ${id}) as s`))[0]?.s).toBe("booked");
    const after = (await sessions()).find((s) => s.session_id === session);
    expect(after).toMatchObject({ child_status: "booked", booked: 1 });
    // cours plein : l'enfant d'un autre parent passe en liste d'attente
    await adminSql()`update public.sessions set capacity = 1 where id = ${session}`;
    const other = await consentedChild();
    expect((await asUser(other.parent, (tx) => tx<{ s: string }[]>`select public.book_for_child(${session}, ${other.id}) as s`))[0]?.s).toBe("waitlisted");
    // le premier annule : le second est promu
    await asUser(parent, (tx) => tx`select public.cancel_child_booking(${session}, ${id})`);
    expect((await adminSql()`select status from public.session_bookings where session_id = ${session} and person_id = ${other.id}`)[0]?.status).toBe("booked");
  });

  it("refuse un tiers, un accord non confirmé ou retiré, et un cours d'un autre club", async () => {
    const { id, parent } = await consentedChild();
    const stranger = await createUser("stranger-book");
    const session = await createSession(w.academyA);
    expect((await failing(() => asUser(stranger, (tx) => tx`select public.book_for_child(${session}, ${id})`))).message).toContain("not_found");
    expect((await failing(() => asUser(stranger, (tx) => tx`select * from public.child_sessions(${id})`))).message).toContain("not_found");
    const foreign = await createSession(w.academyB);
    expect((await failing(() => asUser(parent, (tx) => tx`select public.book_for_child(${foreign}, ${id})`))).message).toContain("not_found");
    const pending = await createMinor(w.carl);
    await adminSql()`update public.guardianships set guardian_user_id = ${parent.id} where child_id = ${pending.id}`;
    expect((await failing(() => asUser(parent, (tx) => tx`select public.book_for_child(${session}, ${pending.id})`))).message).toContain("consent_required");
    await asUser(parent, (tx) => tx`select public.withdraw_guardian_consent(${id})`);
    expect((await failing(() => asUser(parent, (tx) => tx`select public.book_for_child(${session}, ${id})`))).message).toContain("consent_required");
  });
});
