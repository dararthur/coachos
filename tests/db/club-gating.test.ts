import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const email = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.invalid`;

/** Comme le serveur : rôle app_server, sans compte. */
const submit = (e: string, name = "Club Demande") =>
  appSql()<{ id: string; is_new: boolean }[]>`select id, is_new from app_private.submit_academy_request(${name}, 'Europe/Paris', 'EUR', 'Camille Martin', ${e}, null)`;
const registerAdmin = (id: string) => appSql()`select app_private.register_platform_admin(${id})`;

describe("création de club sur demande approuvée", () => {
  it("plus aucune création libre : create_academy n'existe plus et la fonction interne est fermée aux comptes", async () => {
    const u = await createUser("gate-free");
    expect((await failing(() => asUser(u, (tx) => tx`select public.create_academy('Club', 'Europe/Paris', 'EUR')`))).message).toMatch(/does not exist|permission denied/);
    expect((await failing(() => asUser(u, (tx) => tx`select app_private.create_academy_for(${u.id}, 'Club', 'Europe/Paris', 'EUR')`))).message).toMatch(/permission denied/);
  });

  it("une demande est enregistrée sans compte ; la même demande n'est pas dupliquée ; au plus 3 en attente par adresse", async () => {
    const e = email("req");
    const [first] = await submit(e);
    expect(first!.is_new).toBe(true);
    const [again] = await submit(e);
    expect(again).toMatchObject({ id: first!.id, is_new: false });
    await submit(e, "Deuxième club");
    await submit(e, "Troisième club");
    expect((await failing(() => submit(e, "Quatrième club"))).message).toContain("coachos:academy_request_limit");
    // Les tables ne sont lisibles par aucun rôle applicatif.
    const u = await createUser("gate-read");
    expect((await failing(() => asUser(u, (tx) => tx`select * from public.academy_requests`))).message).toMatch(/permission denied/);
    expect((await failing(() => appSql()`select * from public.academy_requests`)).message).toMatch(/permission denied/);
  });

  it("seul l'administrateur désigné liste et décide ; un autre compte, même confirmé, est refusé", async () => {
    const admin = await createUser("gate-admin");
    const other = await createUser("gate-other");
    const e = email("req2");
    const [req] = await submit(e);
    await registerAdmin(admin.id);

    expect((await failing(() => asUser(other, (tx) => tx`select * from public.list_academy_requests()`))).code).toBe("42501");
    expect((await failing(() => asUser(other, (tx) => tx`select * from public.decide_academy_request(${req!.id}, true)`))).code).toBe("42501");
    const rows = await asUser(admin, (tx) => tx<{ id: string; status: string }[]>`select id, status from public.list_academy_requests()`);
    expect(rows.find((r) => r.id === req!.id)?.status).toBe("pending");

    const [decided] = await asUser(admin, (tx) => tx<{ email: string; status: string }[]>`select email, status from public.decide_academy_request(${req!.id}, true)`);
    expect(decided).toMatchObject({ email: e, status: "approved" });
    // Une demande déjà tranchée ne peut plus l'être.
    expect((await failing(() => asUser(admin, (tx) => tx`select * from public.decide_academy_request(${req!.id}, false)`))).message).toContain("coachos:not_found");
  });

  it("un seul administrateur : en désigner un autre retire l'ancien ; un compte non confirmé ne peut pas être désigné", async () => {
    const a = await createUser("gate-a1");
    const b = await createUser("gate-a2");
    const unconfirmed = await createUser("gate-a3", false);
    await registerAdmin(a.id);
    await registerAdmin(b.id);
    expect((await failing(() => asUser(a, (tx) => tx`select * from public.list_academy_requests()`))).code).toBe("42501");
    await asUser(b, (tx) => tx`select * from public.list_academy_requests()`);
    expect((await failing(() => registerAdmin(unconfirmed.id))).message).toContain("coachos:email_not_confirmed");
    // Un compte connecté ne peut pas se désigner lui-même.
    expect((await failing(() => asUser(a, (tx) => tx`select app_private.register_platform_admin(${a.id})`))).message).toMatch(/permission denied/);
  });

  it("le demandeur crée son club une fois la demande approuvée, avec une adresse CONFIRMÉE, et une seule fois", async () => {
    const admin = await createUser("gate-b-admin");
    await registerAdmin(admin.id);
    const e = email("founder");
    const [req] = await submit(e);

    const founder = await adminSql()<{ id: string }[]>`insert into auth.users (name, email, email_verified) values ('Fondatrice', ${e}, true) returning id`;
    const user = { id: founder[0]!.id, email: e };
    // Avant l'approbation : rien à réclamer.
    expect(await asUser(user, (tx) => tx`select * from public.my_approved_academy_request()`)).toHaveLength(0);
    expect((await failing(() => asUser(user, (tx) => tx`select public.claim_academy_request(${req!.id}, 'Mon club', 'Europe/Paris', 'EUR')`))).message).toContain("coachos:not_found");

    await asUser(admin, (tx) => tx`select * from public.decide_academy_request(${req!.id}, true)`);
    const [mine] = await asUser(user, (tx) => tx<{ id: string; name: string }[]>`select id, name from public.my_approved_academy_request()`);
    expect(mine).toMatchObject({ id: req!.id, name: "Club Demande" });

    // Un autre compte (même confirmé) ne peut pas réclamer la demande.
    const stranger = await createUser("gate-stranger");
    expect((await failing(() => asUser(stranger, (tx) => tx`select public.claim_academy_request(${req!.id}, 'Volé', 'Europe/Paris', 'EUR')`))).message).toContain("coachos:not_found");

    const [claimed] = await asUser(user, (tx) => tx<{ id: string }[]>`select public.claim_academy_request(${req!.id}, 'Club Corrigé', 'Europe/Paris', 'EUR') as id`);
    const [academy] = await adminSql()<{ name: string }[]>`select name from public.academies where id = ${claimed!.id}`;
    expect(academy!.name).toBe("Club Corrigé");
    const [membership] = await adminSql()<{ role: string }[]>`select role from public.academy_memberships where academy_id = ${claimed!.id} and user_id = ${user.id}`;
    expect(membership!.role).toBe("owner");
    expect((await adminSql()`select status from public.academy_requests where id = ${req!.id}`)[0]!.status).toBe("claimed");
    // Deuxième tentative : la demande est consommée.
    expect((await failing(() => asUser(user, (tx) => tx`select public.claim_academy_request(${req!.id}, 'Encore', 'Europe/Paris', 'EUR')`))).message).toContain("coachos:not_found");
  });

  it("une demande refusée ne donne aucun droit ; la rétention supprime les anciennes demandes", async () => {
    const admin = await createUser("gate-c-admin");
    await registerAdmin(admin.id);
    const e = email("refused");
    const [req] = await submit(e);
    await asUser(admin, (tx) => tx`select * from public.decide_academy_request(${req!.id}, false)`);
    expect((await appSql()<{ ok: boolean }[]>`select app_private.signup_email_allowed(${e}) as ok`)[0]!.ok).toBe(false);

    const [old] = await submit(email("old"));
    await adminSql()`update public.academy_requests set created_at = now() - interval '200 days' where id = ${old!.id}`;
    const [purged] = await appSql()<{ n: number }[]>`select app_private.purge_academy_requests() as n`;
    expect(purged!.n).toBeGreaterThanOrEqual(1);
    expect(await adminSql()`select 1 from public.academy_requests where id = ${old!.id}`).toHaveLength(0);
  });
});

describe("ticket d'inscription", () => {
  it("un code de club valide est reconnu (saisie souple), un code erroné ou absent non", async () => {
    const owner = await createUser("tk-owner");
    const academy = await createAcademy(owner, "Club Ticket");
    const [row] = await adminSql()<{ code: string }[]>`select code from public.academy_join_codes where academy_id = ${academy}`;
    const code = row!.code;
    const valid = async (c: string) => (await appSql()<{ ok: boolean }[]>`select app_private.join_code_valid(${c}) as ok`)[0]!.ok;
    expect(await valid(code)).toBe(true);
    expect(await valid(code.toLowerCase().replace(/^(.{4})/, "$1-"))).toBe(true);
    expect(await valid("ZZZZZZZZ")).toBe(false);
    expect(await valid("")).toBe(false);
  });

  it("sans code : invitation en attente ou demande approuvée pour l'adresse ; ni expirée ni consommée ni refusée", async () => {
    const owner = await createUser("tk2-owner");
    const academy = await createAcademy(owner, "Club Invitations");
    const allowed = async (e: string) => (await appSql()<{ ok: boolean }[]>`select app_private.signup_email_allowed(${e}) as ok`)[0]!.ok;
    const invited = email("invited");
    expect(await allowed(invited)).toBe(false);
    await adminSql()`insert into public.invitations (academy_id, email, role, token_hash, expires_at) values (${academy}, ${invited}, 'coach', ${randomBytes(32).toString("hex")}, now() + interval '3 days')`;
    expect(await allowed(invited)).toBe(true);
    expect(await allowed(invited.toUpperCase())).toBe(true);
    await adminSql()`update public.invitations set expires_at = now() - interval '1 minute' where email = ${invited}`;
    expect(await allowed(invited)).toBe(false);
    await adminSql()`update public.invitations set expires_at = now() + interval '3 days', accepted_at = now() where email = ${invited}`;
    expect(await allowed(invited)).toBe(false);

    const admin = await createUser("tk2-admin");
    await registerAdmin(admin.id);
    const founder = email("tk-founder");
    const [req] = await submit(founder);
    expect(await allowed(founder)).toBe(false);
    await asUser(admin, (tx) => tx`select * from public.decide_academy_request(${req!.id}, true)`);
    expect(await allowed(founder)).toBe(true);
  });

  it("les fonctions de ticket et de purge ne sont pas exécutables par un compte connecté", async () => {
    const u = await createUser("tk3");
    for (const call of [
      (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select app_private.signup_email_allowed('a@b.c')`,
      (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select app_private.join_code_valid('ABCDEFGH')`,
      (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => tx`select app_private.purge_academy_requests()`,
    ]) {
      expect((await failing(() => asUser(u, call))).message).toMatch(/permission denied/);
    }
  });
});
