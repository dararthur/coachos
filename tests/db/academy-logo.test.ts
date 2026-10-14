import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const PIXEL = Buffer.from("52494646240000005745425056503820180000003001009d012a0100010002003425a400037000fefb94000000", "hex");
const setLogo = (u: { id: string }, academy: string, type = "image/webp", data: Buffer = PIXEL) => asUser(u, (tx) => tx`select public.set_academy_logo(${academy}, ${type}, ${data})`);
const count = async (academy: string) => (await adminSql()`select 1 from public.academy_logos where academy_id = ${academy}`).length;
const visible = (u: { id: string }, academy: string) => asUser(u, (tx) => tx`select 1 from public.academy_logos where academy_id = ${academy}`).then((r) => r.length);

describe("logo du club", () => {
  it("un administrateur pose, remplace et retire le logo ; types et taille bornés", async () => {
    const owner = await createUser("lg-owner");
    const academy = await createAcademy(owner);
    await setLogo(owner, academy);
    await setLogo(owner, academy, "image/png");
    expect((await adminSql()<{ content_type: string }[]>`select content_type from public.academy_logos where academy_id = ${academy}`)[0]!.content_type).toBe("image/png");
    expect((await failing(() => setLogo(owner, academy, "image/svg+xml"))).message).toContain("coachos:photo_invalid");
    expect((await failing(() => setLogo(owner, academy, "image/webp", Buffer.alloc(204_801)))).message).toContain("coachos:photo_invalid");
    await asUser(owner, (tx) => tx`select public.remove_academy_logo(${academy})`);
    expect(await count(academy)).toBe(0);
  });

  it("ni coach ni membre ne modifient le logo ; tout le club le voit, pas les autres clubs", async () => {
    const owner = await createUser("lg2-owner");
    const academy = await createAcademy(owner);
    const coach = await createUser("lg2-coach");
    const member = await createUser("lg2-member");
    await addMember(academy, coach, "coach");
    await addMember(academy, member, "member");
    await expect(failing(() => setLogo(coach, academy))).resolves.toMatchObject({ code: "42501" });
    await expect(failing(() => setLogo(member, academy))).resolves.toMatchObject({ code: "42501" });
    await setLogo(owner, academy);
    await expect(failing(() => asUser(member, (tx) => tx`select public.remove_academy_logo(${academy})`))).resolves.toMatchObject({ code: "42501" });
    expect(await visible(member, academy)).toBe(1);
    expect(await visible(coach, academy)).toBe(1);
    const other = await createUser("lg2-other");
    await createAcademy(other, "Autre club");
    expect(await visible(other, academy)).toBe(0);
    expect((await failing(() => asUser(member, (tx) => tx`insert into public.academy_logos (academy_id, content_type, data) values (${academy}, 'image/webp', ${PIXEL})`))).message).toMatch(/permission denied/);
  });
});
