import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createUser, failing, type World } from "./support";

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
    await adminSql()`insert into public.person_photos (person_id, academy_id, content_type, data) values (${id}, ${w.academyA}, 'image/png', ${Buffer.from([0x89, 0x50, 0x4e, 0x47])})`;
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
