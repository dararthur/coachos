import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const PIXEL = Buffer.from("52494646240000005745425056503820180000003001009d012a0100010002003425a400037000fefb94000000", "hex");

async function member(academy: string, label: string, optIn = false) {
  const user = await createUser(label);
  await addMember(academy, user, "member");
  const person = await createPerson(academy, label, "Photo");
  await adminSql()`update public.people set user_id = ${user.id}, ranking_opt_in = ${optIn} where id = ${person}`;
  return { user, person };
}
const setPhoto = (u: { id: string }, academy: string, type = "image/webp", data: Buffer = PIXEL) =>
  asUser(u, (tx) => tx`select public.set_my_photo(${academy}, ${type}, ${data})`);
const photoCount = async (person: string) => (await adminSql()`select 1 from public.person_photos where person_id = ${person}`).length;
const visible = (u: { id: string }, person: string) => asUser(u, (tx) => tx`select person_id from public.person_photos where person_id = ${person}`).then((r) => r.length);

describe("photo de profil", () => {
  it("un membre pose, remplace et retire sa photo ; types et taille bornés", async () => {
    const owner = await createUser("ph-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "ph-a");
    await setPhoto(a.user, academy);
    await setPhoto(a.user, academy, "image/jpeg");
    const [row] = await adminSql()<{ content_type: string }[]>`select content_type from public.person_photos where person_id = ${a.person}`;
    expect(row!.content_type).toBe("image/jpeg");
    expect((await failing(() => setPhoto(a.user, academy, "image/svg+xml"))).message).toContain("coachos:photo_invalid");
    expect((await failing(() => setPhoto(a.user, academy, "image/webp", Buffer.alloc(204_801)))).message).toContain("coachos:photo_invalid");
    await asUser(a.user, (tx) => tx`select public.remove_person_photo(${academy}, ${a.person})`);
    expect(await photoCount(a.person)).toBe(0);
  });

  it("un compte sans fiche (coach) ne peut pas poser de photo ; pas d'écriture directe", async () => {
    const owner = await createUser("ph2-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "ph2-a");
    expect((await failing(() => setPhoto(owner, academy))).message).toContain("coachos:not_found");
    expect((await failing(() => asUser(a.user, (tx) => tx`insert into public.person_photos (person_id, academy_id, content_type, data) values (${a.person}, ${academy}, 'image/webp', ${PIXEL})`))).message).toMatch(/permission denied/);
  });

  it("lecture : soi-même et le staff ; les autres membres seulement si la personne figure au classement", async () => {
    const owner = await createUser("ph3-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "ph3-a");
    const b = await member(academy, "ph3-b");
    await setPhoto(a.user, academy);
    expect(await visible(a.user, a.person)).toBe(1);
    expect(await visible(owner, a.person)).toBe(1);
    expect(await visible(b.user, a.person)).toBe(0);
    await adminSql()`update public.people set ranking_opt_in = true where id = ${a.person}`;
    expect(await visible(b.user, a.person)).toBe(1);
    // Un autre club ne voit jamais la photo.
    const other = await createUser("ph3-other");
    await createAcademy(other, "Autre club");
    expect(await visible(other, a.person)).toBe(0);
  });

  it("seuls le membre lui-même et un administrateur retirent une photo", async () => {
    const owner = await createUser("ph4-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "ph4-a", true);
    const b = await member(academy, "ph4-b", true);
    const coach = await createUser("ph4-coach");
    await addMember(academy, coach, "coach");
    await setPhoto(a.user, academy);
    await expect(failing(() => asUser(b.user, (tx) => tx`select public.remove_person_photo(${academy}, ${a.person})`))).resolves.toMatchObject({ code: "42501" });
    await expect(failing(() => asUser(coach, (tx) => tx`select public.remove_person_photo(${academy}, ${a.person})`))).resolves.toMatchObject({ code: "42501" });
    expect(await photoCount(a.person)).toBe(1);
    await asUser(owner, (tx) => tx`select public.remove_person_photo(${academy}, ${a.person})`);
    expect(await photoCount(a.person)).toBe(0);
  });

  it("l'anonymisation et la suppression effacent la photo ; l'archivage seul la conserve", async () => {
    const owner = await createUser("ph5-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "ph5-a");
    const b = await member(academy, "ph5-b");
    const c = await member(academy, "ph5-c");
    for (const m of [a, b, c]) await setPhoto(m.user, academy);
    await adminSql()`update public.people set archived_at = now() where id = ${a.person}`;
    expect(await photoCount(a.person)).toBe(1);
    await asUser(owner, (tx) => tx`select public.erase_person(${b.person}, 'anonymize')`);
    expect(await photoCount(b.person)).toBe(0);
    await asUser(owner, (tx) => tx`select public.erase_person(${c.person}, 'delete')`);
    expect(await photoCount(c.person)).toBe(0);
  });
});
