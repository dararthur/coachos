import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const codeOf = async (academy: string) => (await adminSql()<{ code: string }[]>`select code from public.academy_join_codes where academy_id = ${academy}`)[0]!.code;
const peopleOf = (academy: string) => adminSql()<{ id: string; user_id: string | null; email: string | null }[]>`select id, user_id, email from public.people where academy_id = ${academy} order by created_at`;

describe("rattachement automatique par e-mail", () => {
  it("le lien d'inscription rattache le compte à la fiche saisie avec la même adresse (casse ignorée)", async () => {
    const owner = await createUser("dup-owner");
    const academy = await createAcademy(owner, "Club doublon e-mail");
    const user = await createUser("dup-joiner");
    const code = await codeOf(academy);
    const existing = await createPerson(academy, "Jeanne", "Martin", { email: user.email.toUpperCase() });
    await asUser(user, (tx) => tx`select public.join_academy_with_code(${code})`);
    const rows = await peopleOf(academy);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existing, user_id: user.id });
    expect(await adminSql()`select 1 from public.audit_events where academy_id = ${academy} and action = 'member.linked_by_email'`).toHaveLength(1);
  });

  it("l'invitation (rôle membre) rattache de la même façon, sans fiche liée explicitement", async () => {
    const owner = await createUser("dup2-owner");
    const academy = await createAcademy(owner, "Club doublon invitation");
    const user = await createUser("dup2-joiner");
    const existing = await createPerson(academy, "Paul", "Durand", { email: user.email });
    const token = randomBytes(32).toString("hex");
    await asUser(owner, (tx) => tx`select public.create_invitation(${academy}, ${user.email}, 'member', null, ${token})`);
    await asUser(user, (tx) => tx`select public.accept_invitation(${token})`);
    const rows = await peopleOf(academy);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existing, user_id: user.id });
  });

  it("une fiche archivée, un mineur ou un compte non confirmé ne sont pas rattachés ; une fiche déjà liée à un autre compte non plus", async () => {
    const owner = await createUser("dup3-owner");
    const academy = await createAcademy(owner, "Club doublon exclusions");
    const code = await codeOf(academy);

    const archivedUser = await createUser("dup3-archived");
    const archived = await createPerson(academy, "Ancien", "Membre", { email: archivedUser.email });
    await adminSql()`update public.people set archived_at = now() where id = ${archived}`;
    await asUser(archivedUser, (tx) => tx`select public.join_academy_with_code(${code})`);
    expect((await peopleOf(academy)).find((p) => p.id === archived)!.user_id).toBeNull();

    const taken = await createUser("dup3-taken");
    const holder = await createUser("dup3-holder");
    const linked = await createPerson(academy, "Déjà", "Lié", { email: taken.email });
    await adminSql()`update public.people set user_id = ${holder.id} where id = ${linked}`;
    await asUser(taken, (tx) => tx`select public.join_academy_with_code(${code})`);
    expect((await peopleOf(academy)).find((p) => p.id === linked)!.user_id).toBe(holder.id);
    expect((await peopleOf(academy)).find((p) => p.user_id === taken.id)!.id).not.toBe(linked);
  });

  it("une fiche d'un autre club n'est jamais touchée", async () => {
    const owner = await createUser("dup4-owner");
    const clubA = await createAcademy(owner, "Club A doublon");
    const clubB = await createAcademy(owner, "Club B doublon");
    const user = await createUser("dup4-user");
    const code = await codeOf(clubA);
    const inB = await createPerson(clubB, "Autre", "Club", { email: user.email });
    await asUser(user, (tx) => tx`select public.join_academy_with_code(${code})`);
    expect((await peopleOf(clubB)).find((p) => p.id === inB)!.user_id).toBeNull();
    expect(await peopleOf(clubA)).toHaveLength(1);
  });
});

describe("fusion d'un doublon par l'équipe", () => {
  async function setup(label: string) {
    const owner = await createUser(`${label}-owner`);
    const academy = await createAcademy(owner, `Club ${label}`);
    const member = await createUser(`${label}-member`);
    const code = await codeOf(academy);
    // Fiche importée sans e-mail, puis inscription avec le lien : deux fiches.
    const keep = await createPerson(academy, "Claire", "Roux");
    await asUser(member, (tx) => tx`select public.join_academy_with_code(${code})`);
    const dup = (await peopleOf(academy)).find((p) => p.user_id === member.id)!.id;
    return { owner, academy, member, keep, dup };
  }

  it("rattache le compte à la fiche d'origine, reporte la réservation et supprime la fiche en double", async () => {
    const { owner, academy, member, keep, dup } = await setup("mg1");
    const session = await createSession(academy);
    await adminSql()`insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at) values (${academy}, ${session}, ${dup}, 'booked', now())`;
    await adminSql()`update public.people set phone = '+33612345678' where id = ${dup}`;

    await asUser(owner, (tx) => tx`select public.merge_member_duplicate(${keep}, ${dup})`);

    const rows = await adminSql()<{ id: string; user_id: string | null; email: string | null; phone: string | null }[]>`select id, user_id, email, phone from public.people where academy_id = ${academy}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: keep, user_id: member.id, email: member.email, phone: "+33612345678" });
    expect(await adminSql()`select 1 from public.session_bookings where person_id = ${keep} and session_id = ${session}`).toHaveLength(1);
    // Le membre y retrouve sa fiche d'origine.
    const [mine] = await asUser(member, (tx) => tx<{ id: string }[]>`select id from public.people where academy_id = ${academy} and user_id = (select auth.uid())`);
    expect(mine!.id).toBe(keep);
    expect(await adminSql()`select 1 from public.audit_events where academy_id = ${academy} and action = 'member.duplicate_merged'`).toHaveLength(1);
  });

  it("n'est possible que pour un propriétaire ou un administrateur du club", async () => {
    const { academy, keep, dup } = await setup("mg2");
    const coach = await createUser("mg2-coach");
    await addMember(academy, coach, "coach");
    const outsider = await createUser("mg2-outsider");
    expect((await failing(() => asUser(coach, (tx) => tx`select public.merge_member_duplicate(${keep}, ${dup})`))).message).toContain("coachos:forbidden");
    expect((await failing(() => asUser(outsider, (tx) => tx`select public.merge_member_duplicate(${keep}, ${dup})`))).message).toContain("coachos:forbidden");
    expect(await peopleOf(academy)).toHaveLength(2);
  });

  it("refuse la fusion si la fiche du compte a déjà des présences : rien n'est perdu", async () => {
    const { owner, academy, keep, dup } = await setup("mg3");
    const session = await createSession(academy);
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${dup}, 'present')`;
    expect((await failing(() => asUser(owner, (tx) => tx`select public.merge_member_duplicate(${keep}, ${dup})`))).message).toContain("coachos:merge_has_history");
    expect(await peopleOf(academy)).toHaveLength(2);
  });

  it("refuse les combinaisons invalides : même fiche, fiche d'origine déjà liée, autre club", async () => {
    const { owner, academy, keep, dup } = await setup("mg4");
    const merge = (a: string, b: string) => failing(() => asUser(owner, (tx) => tx`select public.merge_member_duplicate(${a}, ${b})`));
    expect((await merge(keep, keep)).message).toContain("coachos:merge_invalid");
    expect((await merge(dup, keep)).message).toContain("coachos:merge_invalid");
    const other = await createAcademy(owner, "Autre club mg4");
    const foreign = await createPerson(other, "Étranger", "Club");
    expect((await merge(keep, foreign)).message).toContain("coachos:not_found");
    expect(await peopleOf(academy)).toHaveLength(2);
  });
});
