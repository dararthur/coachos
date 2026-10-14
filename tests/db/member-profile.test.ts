import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createUser, failing, type World } from "./support";
import { createHash } from "node:crypto";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function inviteMember(academy: string, owner: { id: string }, email: string, token: string, personId: string | null = null) {
  await adminSql()`
    insert into public.invitations (academy_id, email, role, person_id, token_hash, expires_at, invited_by)
    values (${academy}, ${email}, 'member', ${personId}, ${hash(token)}, now() + interval '1 day', ${owner.id})`;
}

describe("fiche automatique et profil du membre", () => {
  it("accepter une invitation crée la fiche liée au compte, sans attestation de majorité posée à la place du membre", async () => {
    const owner = await createUser("mp-owner");
    const academy = await createAcademy(owner, "Club profil");
    const user = await createUser("mp-user");
    await adminSql()`update public.profiles set display_name = 'Camille Dupont-Martin' where id = ${user.id}`;
    await inviteMember(academy, owner, user.email, "tok-mp-1");

    await asUser(user, (tx) => tx`select public.accept_invitation(${hash("tok-mp-1")})`);

    const [p] = await adminSql()<Record<string, unknown>[]>`select * from public.people where academy_id = ${academy} and user_id = ${user.id}`;
    expect(p).toMatchObject({ first_name: "Camille", last_name: "Dupont-Martin", adult_attested_at: null, profile_completed_at: null, avatar_style: "neutral", belt: null, belt_stripes: 0 });
    // le membre voit sa fiche (RLS) ; une seule fiche même si on rejoue la création
    expect(await asUser(user, (tx) => tx`select id from public.people where academy_id = ${academy}`)).toHaveLength(1);
  });

  it("une invitation liée à une fiche existante réutilise cette fiche (aucun doublon)", async () => {
    const owner = await createUser("mp2-owner");
    const academy = await createAcademy(owner, "Club lien");
    const user = await createUser("mp2-user");
    const existing = await createPerson(academy, "Déjà", "Importé");
    await inviteMember(academy, owner, user.email, "tok-mp-2", existing);
    await asUser(user, (tx) => tx`select public.accept_invitation(${hash("tok-mp-2")})`);
    const rows = await adminSql()<{ id: string; user_id: string }[]>`select id, user_id from public.people where academy_id = ${academy}`;
    expect(rows).toEqual([{ id: existing, user_id: user.id }]);
  });

  it("update_my_profile : exige l'attestation, enregistre grade et silhouette, ne touche que la fiche de l'appelant", async () => {
    const owner = await createUser("mp3-owner");
    const academy = await createAcademy(owner, "Club maj");
    const user = await createUser("mp3-user");
    const other = await createUser("mp3-other");
    await inviteMember(academy, owner, user.email, "tok-mp-3");
    await inviteMember(academy, owner, other.email, "tok-mp-4");
    await asUser(user, (tx) => tx`select public.accept_invitation(${hash("tok-mp-3")})`);
    await asUser(other, (tx) => tx`select public.accept_invitation(${hash("tok-mp-4")})`);

    const save = (confirm: boolean, belt: string | null = "blue", stripes = 2, avatar = "woman") =>
      asUser(user, (tx) => tx`select public.update_my_profile(${academy}, 'Cam', 'Dup', '+33612345678', ${belt}, ${stripes}, ${avatar}, ${confirm})`);
    expect((await failing(() => save(false))).message).toMatch(/adult_required/);
    await save(true);
    const [p] = await adminSql()<Record<string, unknown>[]>`select * from public.people where academy_id = ${academy} and user_id = ${user.id}`;
    expect(p).toMatchObject({ first_name: "Cam", phone: "+33612345678", belt: "blue", belt_stripes: 2, avatar_style: "woman" });
    expect(p?.adult_attested_at).toBeInstanceOf(Date);
    expect(p?.profile_completed_at).toBeInstanceOf(Date);
    const [o] = await adminSql()<Record<string, unknown>[]>`select first_name, belt from public.people where academy_id = ${academy} and user_id = ${other.id}`;
    expect(o?.belt).toBeNull();

    // valeurs hors liste refusées par la base ; un utilisateur sans fiche dans ce club est refusé
    expect((await failing(() => save(true, "rainbow"))).code).toBe("23514");
    expect((await failing(() => save(true, "blue", 5))).code).toBe("23514");
    expect((await failing(() => asUser(w.bob, (tx) => tx`select public.update_my_profile(${academy}, 'X', 'Y', null, null, 0, 'neutral', true)`))).message).toMatch(/not_found/);
    // pas de modification directe de son propre grade : la RLS ne lui donne aucune ligne à modifier
    const direct = await asUser(user, (tx) => tx`update public.people set belt = 'black' where user_id = ${user.id}`);
    expect(direct.count).toBe(0);
    expect((await adminSql()<{ belt: string }[]>`select belt from public.people where user_id = ${user.id} and academy_id = ${academy}`)[0]?.belt).toBe("blue");
  });

  it("l'anonymisation efface grade, silhouette et téléphone", async () => {
    const owner = await createUser("mp4-owner");
    const academy = await createAcademy(owner, "Club anon");
    const p = await createPerson(academy, "Gra", "Dé");
    await adminSql()`update public.people set belt = 'purple', belt_stripes = 3, avatar_style = 'man', phone = '+33600000001' where id = ${p}`;
    await asUser(owner, (tx) => tx`select public.erase_person(${p}, 'anonymize')`);
    const [row] = await adminSql()<Record<string, unknown>[]>`select belt, belt_stripes, avatar_style, phone from public.people where id = ${p}`;
    expect(row).toEqual({ belt: null, belt_stripes: 0, avatar_style: "neutral", phone: null });
  });
});
