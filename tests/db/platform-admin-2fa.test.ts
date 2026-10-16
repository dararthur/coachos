import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createUser, failing } from "./support";

/** Code de seconde authentification de l'administrateur (migration 001000) : lié à la session, 5 essais, 10 minutes, usage unique. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const hash = (code: string) => createHmac("sha256", "test-secret").update(code).digest("hex");
const issue = (user: string, session: string, code: string, ttl = 600) => appSql()`select app_private.admin_code_issue(${user}, ${session}, ${hash(code)}, ${ttl})`;
const check = async (user: string, session: string, code: string) => (await appSql()<{ ok: boolean }[]>`select app_private.admin_code_check(${user}, ${session}, ${hash(code)}) as ok`)[0]!.ok;
const pending = async (user: string, session: string) => (await appSql()<{ e: Date | null }[]>`select app_private.admin_code_pending(${user}, ${session}) as e`)[0]!.e;

async function admin() {
  const u = await createUser("2fa-admin");
  await appSql()`select app_private.register_platform_admin(${u.id})`;
  return { user: u, session: randomUUID() };
}

describe("code de seconde authentification par e-mail", () => {
  it("le bon code ouvre une fois ; le même code ne resert pas", async () => {
    const a = await admin();
    await issue(a.user.id, a.session, "123456");
    expect(await pending(a.user.id, a.session)).toBeInstanceOf(Date);
    expect(await check(a.user.id, a.session, "123456")).toBe(true);
    expect(await check(a.user.id, a.session, "123456")).toBe(false);
    expect(await pending(a.user.id, a.session)).toBeNull();
  });

  it("un code demandé par une autre session ne vaut rien ici", async () => {
    const a = await admin();
    const other = randomUUID();
    await issue(a.user.id, other, "111111");
    expect(await pending(a.user.id, a.session)).toBeNull();
    expect(await check(a.user.id, a.session, "111111")).toBe(false);
    expect(await check(a.user.id, other, "111111")).toBe(true);
  });

  it("un nouveau code remplace l'ancien ; tout code d'une autre session en attente est aussi invalidé", async () => {
    const a = await admin();
    const other = randomUUID();
    await issue(a.user.id, a.session, "111111");
    await issue(a.user.id, other, "222222");
    expect(await check(a.user.id, a.session, "111111")).toBe(false);
    await issue(a.user.id, a.session, "333333");
    expect(await check(a.user.id, a.session, "222222")).toBe(false);
    expect(await check(a.user.id, a.session, "333333")).toBe(true);
  });

  it("cinq essais au plus : même le bon code est ensuite refusé", async () => {
    const a = await admin();
    await issue(a.user.id, a.session, "424242");
    for (let i = 0; i < 5; i++) expect(await check(a.user.id, a.session, `00000${i}`)).toBe(false);
    expect(await check(a.user.id, a.session, "424242")).toBe(false);
    expect(await pending(a.user.id, a.session)).toBeNull();
  });

  it("un code expiré est refusé", async () => {
    const a = await admin();
    await issue(a.user.id, a.session, "555555");
    await adminSql()`update public.platform_admin_codes set expires_at = now() - interval '1 second' where user_id = ${a.user.id}`;
    expect(await pending(a.user.id, a.session)).toBeNull();
    expect(await check(a.user.id, a.session, "555555")).toBe(false);
  });

  it("la durée de validité est bornée (1 min à 1 h) et seul l'administrateur désigné peut en recevoir un", async () => {
    const a = await admin();
    expect((await failing(() => issue(a.user.id, a.session, "666666", 5))).message).toContain("coachos:validation");
    expect((await failing(() => issue(a.user.id, a.session, "666666", 99_999))).message).toContain("coachos:validation");
    const stranger = await createUser("2fa-stranger");
    expect((await failing(() => issue(stranger.id, a.session, "666666"))).code).toBe("42501");
    expect((await failing(() => check(stranger.id, a.session, "666666"))).code).toBe("42501");
  });

  it("l'empreinte seule est stockée, et aucun compte (même l'administrateur) ne lit ni n'appelle ces objets", async () => {
    const a = await admin();
    await issue(a.user.id, a.session, "777777");
    const [row] = await adminSql()<{ code_hash: string }[]>`select code_hash from public.platform_admin_codes where user_id = ${a.user.id}`;
    expect(row!.code_hash).toBe(hash("777777"));
    expect(JSON.stringify(row)).not.toContain("777777");
    expect((await failing(() => asUser(a.user, (tx) => tx`select * from public.platform_admin_codes`))).message).toMatch(/permission denied/);
    expect((await failing(() => asUser(a.user, (tx) => tx`select app_private.admin_code_check(${a.user.id}, ${a.session}, ${hash("777777")})`))).message).toMatch(/permission denied/);
  });

  it("changer d'administrateur supprime les codes de l'ancien", async () => {
    const a = await admin();
    await issue(a.user.id, a.session, "888888");
    const next = await createUser("2fa-next");
    await appSql()`select app_private.register_platform_admin(${next.id})`;
    expect(await adminSql()`select 1 from public.platform_admin_codes where user_id = ${a.user.id}`).toHaveLength(0);
  });
});
