import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withApp } from "@/server/db/client";
import {
  addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing,
  type World,
} from "./support";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

describe("effacement d'un membre", () => {
  it("anonymise : l'identité disparaît, les présences restent comme statistiques", async () => {
    const person = await createPerson(w.academyA, "Marie", "Curie", { email: "marie.curie@example.invalid", external: "MC-1" });
    const session = await createSession(w.academyA);
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${session}, ${person}, 'present')`;

    await asUser(w.alice, (tx) => tx`select public.erase_person(${person}, 'anonymize')`);

    const [p] = await adminSql()<Record<string, unknown>[]>`select * from public.people where id = ${person}`;
    expect(p).toMatchObject({ first_name: "Membre", last_name: "anonymisé", email: null, external_ref: null, user_id: null });
    expect(p?.anonymized_at).toBeInstanceOf(Date);
    expect(await adminSql()`select 1 from public.attendance where person_id = ${person}`).toHaveLength(1);
    // plus aucune trace de l'identité dans toute la base
    const dump = JSON.stringify(await adminSql()`select * from public.people p left join public.attendance a on a.person_id = p.id where p.id = ${person}`);
    expect(dump).not.toMatch(/Marie|Curie|marie\.curie/);
    const audit = JSON.stringify(await adminSql()`select * from public.audit_events where entity_id = ${person}`);
    expect(audit).toContain("member.anonymized");
    expect(audit).not.toMatch(/Marie|Curie/);
  });

  it("supprime : la fiche et ses présences disparaissent", async () => {
    const person = await createPerson(w.academyA, "Del", "Ete");
    const session = await createSession(w.academyA);
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${session}, ${person}, 'late')`;
    await asUser(w.adam, (tx) => tx`select public.erase_person(${person}, 'delete')`);
    expect(await adminSql()`select 1 from public.people where id = ${person}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.attendance where person_id = ${person}`).toHaveLength(0);
  });

  it("n'est pas accessible aux coachs ni aux membres, et refuse un mode inconnu", async () => {
    const person = await createPerson(w.academyA, "Prot", "Egé");
    await expect(asUser(w.carl, (tx) => tx`select public.erase_person(${person}, 'delete')`)).rejects.toMatchObject({ code: "not_found" });
    await expect(asUser(w.mia, (tx) => tx`select public.erase_person(${person}, 'delete')`)).rejects.toMatchObject({ code: "not_found" });
    await expect(asUser(w.alice, (tx) => tx`select public.erase_person(${person}, 'nuke')`)).rejects.toMatchObject({ code: "invalid_mode" });
    expect(await adminSql()`select 1 from public.people where id = ${person}`).toHaveLength(1);
  });

  it("un membre anonymisé ne peut plus recevoir de présence ni être modifié par le client", async () => {
    const person = await createPerson(w.academyA, "An", "Onyme");
    await asUser(w.alice, (tx) => tx`select public.erase_person(${person}, 'anonymize')`);
    await expect(
      asUser(w.alice, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${w.sessionA}, ${person}, 'present')`),
    ).rejects.toMatchObject({ code: "person_archived" });
  });
});

describe("export des données", () => {
  it("exporte la fiche et les présences d'un membre, et journalise l'export", async () => {
    const out = await asUser(w.alice, (tx) => tx<{ d: Record<string, unknown> }[]>`select public.export_person_data(${w.personA}) as d`);
    const data = out[0]!.d as { person: { first_name: string; email: string }; attendance: unknown[]; academy: string };
    expect(data.person).toMatchObject({ first_name: "Alba", email: "alba@example.invalid" });
    expect(data.attendance.length).toBeGreaterThan(0);
    expect(data.academy).toBe("Club A");
    const audit = await adminSql()`select 1 from public.audit_events where action = 'member.data_exported' and entity_id = ${w.personA}`;
    expect(audit.length).toBeGreaterThan(0);
  });

  it("export de mes données : uniquement les miennes", async () => {
    const [row] = await asUser(w.mia, (tx) => tx<{ d: Record<string, unknown> }[]>`select public.export_my_data() as d`);
    const text = JSON.stringify(row!.d);
    expect(text).toContain("Mia");
    expect(text).not.toMatch(/Alba|alba@example|Bea|Club B/);
  });
});

describe("suppression de compte", () => {
  it("est refusée pour l'unique propriétaire d'une académie", async () => {
    await expect(asUser(w.alice, (tx) => tx`select public.delete_my_account()`)).rejects.toMatchObject({ code: "sole_owner" });
    expect(await adminSql()`select 1 from auth.users where id = ${w.alice.id}`).toHaveLength(1);
  });

  it("supprime le compte, les appartenances et pseudonymise les journaux ; les données du club restent", async () => {
    const coach = await createUser("sortant");
    await addMember(w.academyA, coach, "coach");
    const session = await createSession(w.academyA, { instructor: coach.id });
    await asUser(coach, (tx) => tx`select public.export_my_data()`); // génère un événement d'audit à son nom
    await asUser(coach, (tx) => tx`select public.delete_my_account()`);
    expect(await adminSql()`select 1 from auth.users where id = ${coach.id}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.profiles where id = ${coach.id}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.academy_memberships where user_id = ${coach.id}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.audit_events where actor_user_id = ${coach.id}`).toHaveLength(0);
    const [s] = await adminSql()<{ instructor_id: string | null }[]>`select instructor_id from public.sessions where id = ${session}`;
    expect(s?.instructor_id).toBeNull();
  });

  it("un copropriétaire peut supprimer son compte", async () => {
    const owner2 = await createUser("copro");
    await adminSql()`insert into public.academy_memberships (academy_id, user_id, role) values (${w.academyA}, ${owner2.id}, 'owner')`;
    await asUser(owner2, (tx) => tx`select public.delete_my_account()`);
    expect(await adminSql()`select 1 from auth.users where id = ${owner2.id}`).toHaveLength(0);
  });
});

describe("purge de rétention", () => {
  it("anonymise les archivés au-delà du délai, purge invitations/audit/compteurs périmés, épargne le reste", async () => {
    const academy = await createAcademy(await createUser("retention"), "Club rétention");
    const old = await createPerson(academy, "Vieux", "Archivé", { email: "vieux@example.invalid" });
    const recent = await createPerson(academy, "Recent", "Archivé", { email: "recent@example.invalid" });
    const active = await createPerson(academy, "Toujours", "Actif");
    await adminSql()`update public.academies set retention_months = 12 where id = ${academy}`;
    await adminSql()`update public.people set archived_at = now() - interval '13 months' where id = ${old}`;
    await adminSql()`update public.people set archived_at = now() - interval '2 months' where id = ${recent}`;
    await adminSql()`insert into public.invitations (academy_id, email, role, token_hash, expires_at)
      values (${academy}, 'perime@example.invalid', 'coach', ${"e".repeat(63) + "1"}, now() - interval '40 days'),
             (${academy}, 'recent-inv@example.invalid', 'coach', ${"e".repeat(63) + "2"}, now() + interval '1 day')`;
    await adminSql()`insert into public.audit_events (academy_id, action, created_at) values (${academy}, 'test.vieux', now() - interval '25 months'), (${academy}, 'test.recent', now())`;
    await adminSql()`insert into app_private.rate_limits (key, window_start, hits) values ('test:old', now() - interval '2 days', 1), ('test:new', now(), 1)`;

    const result = await withApp((tx) => tx<{ r: Record<string, number> }[]>`select app_private.purge_expired_data() as r`, appSql());
    expect(result[0]!.r).toMatchObject({ members_anonymized: 1, invitations_deleted: 1 });

    const rows = await adminSql()<{ id: string; anonymized_at: Date | null; email: string | null }[]>`select id, anonymized_at, email from public.people where academy_id = ${academy}`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[old]).toMatchObject({ email: null });
    expect(byId[old]?.anonymized_at).not.toBeNull();
    expect(byId[recent]?.anonymized_at).toBeNull();
    expect(byId[active]?.anonymized_at).toBeNull();
    expect(await adminSql()`select 1 from public.invitations where email = 'perime@example.invalid'`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.invitations where email = 'recent-inv@example.invalid'`).toHaveLength(1);
    expect(await adminSql()`select 1 from public.audit_events where action = 'test.vieux'`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.audit_events where action = 'test.recent'`).toHaveLength(1);
    expect(await adminSql()`select 1 from app_private.rate_limits where key = 'test:old'`).toHaveLength(0);
    expect(await adminSql()`select 1 from app_private.rate_limits where key = 'test:new'`).toHaveLength(1);
  });

  it("n'est pas appelable par un utilisateur authentifié", async () => {
    const e = await failing(() => asUser(w.alice, (tx) => tx`select app_private.purge_expired_data()`));
    expect(e.code).toBe("42501");
  });
});

describe("limitation de débit", () => {
  it("autorise N appels par fenêtre puis refuse, et ré-ouvre la fenêtre ensuite", async () => {
    const key = `test:rl:${Math.random()}`;
    const hit = () => withApp((tx) => tx<{ ok: boolean }[]>`select app_private.hit_rate_limit(${key}, 3, 60) as ok`, appSql()).then((r) => r[0]!.ok);
    expect([await hit(), await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false, false]);
    await adminSql()`update app_private.rate_limits set window_start = now() - interval '2 minutes' where key = ${key}`;
    expect(await hit()).toBe(true);
  });

  it("n'est pas appelable par un utilisateur authentifié (pas de pollution des compteurs d'autrui)", async () => {
    const e = await failing(() => asUser(w.alice, (tx) => tx`select app_private.hit_rate_limit('login:victim', 1, 60)`));
    expect(e.code).toBe("42501");
  });
});

describe("journal d'audit", () => {
  it("est en lecture seule pour les administrateurs, invisible pour coachs et membres, et non falsifiable", async () => {
    expect((await asUser(w.alice, (tx) => tx`select id from public.audit_events where academy_id = ${w.academyA}`)).length).toBeGreaterThan(0);
    expect(await asUser(w.carl, (tx) => tx`select id from public.audit_events`)).toHaveLength(0);
    expect(await asUser(w.mia, (tx) => tx`select id from public.audit_events`)).toHaveLength(0);
    for (const sql of [
      "insert into public.audit_events (academy_id, action) values (null, 'forged')",
      "update public.audit_events set action = 'x'",
      "delete from public.audit_events",
    ]) {
      const e = await failing(() => asUser(w.alice, (tx) => tx.unsafe(sql)));
      expect(e.code, sql).toBe("42501");
    }
  });

  it("record_event n'accepte que des actions connues et ne stocke que des compteurs", async () => {
    await expect(asUser(w.alice, (tx) => tx`select public.record_event(${w.academyA}, 'members.hacked', '{}'::jsonb)`)).rejects.toMatchObject({ code: "invalid_action" });
    await asUser(w.alice, (tx) => tx`select public.record_event(${w.academyA}, 'members.imported', ${tx.json({ created: 4, skipped: 1, email: "leak@example.invalid", nested: { a: 1 } })})`);
    const [row] = await adminSql()<{ metadata: Record<string, unknown> }[]>`select metadata from public.audit_events where action = 'members.imported' and academy_id = ${w.academyA} order by id desc limit 1`;
    expect(row?.metadata).toEqual({ created: 4, skipped: 1 });
    await expect(asUser(w.carl, (tx) => tx`select public.record_event(${w.academyA}, 'members.exported', '{}'::jsonb)`)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("les modifications des paramètres de l'académie et l'archivage de membres sont journalisés", async () => {
    await asUser(w.alice, (tx) => tx`update public.academies set retention_months = 30 where id = ${w.academyA}`);
    await asUser(w.alice, (tx) => tx`update public.people set archived_at = now() where id = ${w.personA}`);
    await asUser(w.alice, (tx) => tx`update public.people set archived_at = null where id = ${w.personA}`);
    const actions = (await adminSql()<{ action: string }[]>`select action from public.audit_events where academy_id = ${w.academyA}`).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["academy.settings_updated", "member.archived", "member.restored"]));
  });
});
