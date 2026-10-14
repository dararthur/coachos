import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const codeOf = async (academy: string) => (await adminSql()<{ code: string }[]>`select code from public.academy_join_codes where academy_id = ${academy}`)[0]!.code;

describe("inscription autonome par code de club", () => {
  it("chaque club reçoit un code de 8 caractères à sa création, distinct des autres", async () => {
    const owner = await createUser("jc-owner");
    const a = await createAcademy(owner, "Club code A");
    const b = await createAcademy(owner, "Club code B");
    const [ca, cb] = [await codeOf(a), await codeOf(b)];
    expect(ca).toMatch(/^[A-Z2-9]{8}$/);
    expect(ca).not.toBe(cb);
  });

  it("un compte confirmé rejoint le club en tant que membre : appartenance + fiche créés, sans attestation posée à sa place", async () => {
    const owner = await createUser("jc2-owner");
    const academy = await createAcademy(owner, "Club rejoindre");
    const user = await createUser("jc2-user");
    const code = await codeOf(academy);

    // saisie souple : minuscules, tiret, espaces
    const lenient = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    const [joined] = await asUser(user, (tx) => tx<{ id: string }[]>`select public.join_academy_with_code(${lenient}) as id`);
    expect(joined!.id).toBe(academy);

    const [m] = await adminSql()<{ role: string }[]>`select role from public.academy_memberships where academy_id = ${academy} and user_id = ${user.id}`;
    expect(m!.role).toBe("member");
    const [p] = await adminSql()<Record<string, unknown>[]>`select adult_attested_at, profile_completed_at from public.people where academy_id = ${academy} and user_id = ${user.id}`;
    expect(p).toMatchObject({ adult_attested_at: null, profile_completed_at: null });

    // idempotent : aucun doublon de fiche ni d'événement
    await asUser(user, (tx) => tx`select public.join_academy_with_code(${code})`);
    expect(await adminSql()`select id from public.people where academy_id = ${academy} and user_id = ${user.id}`).toHaveLength(1);
    expect(await adminSql()`select id from public.audit_events where academy_id = ${academy} and action = 'team.joined_by_code'`).toHaveLength(1);
  });

  it("un code inconnu est refusé ; un e-mail non confirmé ne peut pas rejoindre", async () => {
    const owner = await createUser("jc3-owner");
    const academy = await createAcademy(owner, "Club refus");
    const unconfirmed = await createUser("jc3-unconfirmed", false);
    const user = await createUser("jc3-user");
    const code = await codeOf(academy);

    expect((await failing(() => asUser(user, (tx) => tx`select public.join_academy_with_code('ZZZZZZZZ')`))).message).toContain("coachos:join_code_invalid");
    expect((await failing(() => asUser(user, (tx) => tx`select public.join_academy_with_code('abc')`))).message).toContain("coachos:join_code_invalid");
    expect((await failing(() => asUser(unconfirmed, (tx) => tx`select public.join_academy_with_code(${code})`))).message).toContain("coachos:email_not_confirmed");
    expect(await adminSql()`select 1 from public.academy_memberships where academy_id = ${academy} and user_id = ${user.id}`).toHaveLength(0);
  });

  it("un membre d'équipe qui saisit le code de son club garde son rôle", async () => {
    const owner = await createUser("jc4-owner");
    const academy = await createAcademy(owner, "Club rôle");
    const code = await codeOf(academy);
    await asUser(owner, (tx) => tx`select public.join_academy_with_code(${code})`);
    const [m] = await adminSql()<{ role: string }[]>`select role from public.academy_memberships where academy_id = ${academy} and user_id = ${owner.id}`;
    expect(m!.role).toBe("owner");
    expect(await adminSql()`select 1 from public.people where academy_id = ${academy} and user_id = ${owner.id}`).toHaveLength(0);
  });

  it("le code n'est lisible que de l'encadrement ; seul un administrateur le régénère, et l'ancien cesse de fonctionner", async () => {
    const owner = await createUser("jc5-owner");
    const academy = await createAcademy(owner, "Club régénération");
    const member = await createUser("jc5-member");
    const outsider = await createUser("jc5-outsider");
    const old = await codeOf(academy);
    await asUser(member, (tx) => tx`select public.join_academy_with_code(${old})`);

    expect(await asUser(owner, (tx) => tx`select code from public.academy_join_codes where academy_id = ${academy}`)).toHaveLength(1);
    expect(await asUser(member, (tx) => tx`select code from public.academy_join_codes where academy_id = ${academy}`)).toHaveLength(0);
    expect(await asUser(outsider, (tx) => tx`select code from public.academy_join_codes`)).toHaveLength(0);

    expect((await failing(() => asUser(member, (tx) => tx`select public.regenerate_join_code(${academy})`))).message).toContain("coachos:not_found");
    const [r] = await asUser(owner, (tx) => tx<{ code: string }[]>`select public.regenerate_join_code(${academy}) as code`);
    expect(r!.code).not.toBe(old);
    expect(r!.code).toBe(await codeOf(academy));
    expect((await failing(() => asUser(outsider, (tx) => tx`select public.join_academy_with_code(${old})`))).message).toContain("coachos:join_code_invalid");
    // écriture directe impossible
    expect((await failing(() => asUser(owner, (tx) => tx`update public.academy_join_codes set code = 'AAAAAAAA' where academy_id = ${academy}`))).message).toBeTruthy();
  });

  it("preview_join_code : nom du club ou null, réservé aux comptes connectés", async () => {
    const owner = await createUser("jc6-owner");
    const academy = await createAcademy(owner, "Club aperçu");
    const user = await createUser("jc6-user");
    const code = await codeOf(academy);
    const [ok] = await asUser(user, (tx) => tx<{ n: string | null }[]>`select public.preview_join_code(${code}) as n`);
    expect(ok!.n).toBe("Club aperçu");
    const [ko] = await asUser(user, (tx) => tx<{ n: string | null }[]>`select public.preview_join_code('ZZZZZZZZ') as n`);
    expect(ko!.n).toBeNull();
  });
});
