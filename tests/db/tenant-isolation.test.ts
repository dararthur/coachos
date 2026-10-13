import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { adminSql, appSql, asUser, buildWorld, closeAll, failing, type World } from "./support";

/**
 * Preuve d'isolation multi-tenant : un utilisateur de l'académie A ne peut ni lire ni modifier les
 * données de l'académie B, même en fournissant directement les identifiants de B.
 * Toutes les requêtes passent par withUser() : rôle `authenticated`, RLS active, comme en production.
 */
let w: World;

beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

const TENANT_TABLES = ["people", "disciplines", "class_types", "sessions", "attendance", "invitations", "audit_events"] as const;

describe("lecture inter-tenant", () => {
  for (const actor of ["alice", "adam", "carl", "mia"] as const) {
    it(`${actor} (académie A) ne voit aucune ligne de l'académie B`, async () => {
      const user = w[actor];
      for (const table of TENANT_TABLES) {
        const rows = await asUser(user, (tx) => tx.unsafe(`select 1 from public.${table} where academy_id = $1`, [w.academyB]));
        expect(rows.length, `${actor} lit ${table} de B`).toBe(0);
      }
      const academies = await asUser(user, (tx) => tx`select id from public.academies where id = ${w.academyB}`);
      expect(academies).toHaveLength(0);
      const memberships = await asUser(user, (tx) => tx`select 1 from public.academy_memberships where academy_id = ${w.academyB}`);
      expect(memberships).toHaveLength(0);
    });
  }

  it("la lecture par identifiant exact de B ne renvoie rien", async () => {
    const people = await asUser(w.alice, (tx) => tx`select * from public.people where id = ${w.personB}`);
    const sessions = await asUser(w.alice, (tx) => tx`select * from public.sessions where id = ${w.sessionB}`);
    const attendance = await asUser(w.alice, (tx) => tx`select * from public.attendance where person_id = ${w.personB}`);
    expect([people.length, sessions.length, attendance.length]).toEqual([0, 0, 0]);
  });

  it("les requêtes sans filtre ne renvoient que l'académie courante", async () => {
    const rows = await asUser(w.alice, (tx) => tx<{ academy_id: string }[]>`select distinct academy_id from public.people`);
    expect(rows.map((r) => r.academy_id)).toEqual([w.academyA]);
  });

  it("les profils des autres académies sont invisibles", async () => {
    const rows = await asUser(w.alice, (tx) => tx`select id from public.profiles where id = ${w.bob.id}`);
    expect(rows).toHaveLength(0);
  });
});

describe("écriture inter-tenant", () => {
  it("insérer dans B avec academy_id de B est refusé par la RLS", async () => {
    const e = await failing(() =>
      asUser(w.alice, (tx) => tx`insert into public.people (academy_id, first_name, last_name) values (${w.academyB}, 'Intrus', 'X')`),
    );
    expect(e.code).toBe("42501");
    const d = await failing(() => asUser(w.alice, (tx) => tx`insert into public.disciplines (academy_id, name) values (${w.academyB}, 'Pirate')`));
    expect(d.code).toBe("42501");
  });

  it("modifier ou supprimer des lignes de B n'affecte aucune ligne", async () => {
    const upd = await asUser(w.alice, (tx) => tx`update public.people set first_name = 'Pwned' where id = ${w.personB}`);
    const del = await asUser(w.alice, (tx) => tx`delete from public.sessions where id = ${w.sessionB}`);
    const delAtt = await asUser(w.alice, (tx) => tx`delete from public.attendance where person_id = ${w.personB}`);
    const updAcademy = await asUser(w.alice, (tx) => tx`update public.academies set name = 'Pwned' where id = ${w.academyB}`);
    expect([upd.count, del.count, delAtt.count, updAcademy.count]).toEqual([0, 0, 0, 0]);
    const [b] = await adminSql()<{ first_name: string }[]>`select first_name from public.people where id = ${w.personB}`;
    expect(b?.first_name).toBe("Bea");
    const [a] = await adminSql()<{ name: string }[]>`select name from public.academies where id = ${w.academyB}`;
    expect(a?.name).toBe("Club B");
  });

  it("une ligne de A ne peut pas référencer une ligne de B (clés étrangères composites)", async () => {
    // type de cours de B dans une séance de A
    const s = await failing(() =>
      asUser(w.alice, (tx) => tx`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at)
        values (${w.academyA}, ${w.classTypeB}, now() + interval '2 day', now() + interval '2 day 1 hour')`),
    );
    expect(s.code).toBe("23503");
    // membre de B dans une présence de A
    const a = await failing(() =>
      asUser(w.alice, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status)
        values (${w.academyA}, ${w.sessionA}, ${w.personB}, 'present')`),
    );
    expect(a.code).toBe("23503");
    // séance de B + membre de A, étiquetés A
    const c = await failing(() =>
      asUser(w.alice, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status)
        values (${w.academyA}, ${w.sessionB}, ${w.personA}, 'present')`),
    );
    expect(["42501", "23503"]).toContain(c.code); // refusé par la RLS (séance inaccessible) ou par la FK
  });

  it("changer academy_id d'une ligne existante (déplacement de tenant) est impossible", async () => {
    const e = await failing(() => asUser(w.alice, (tx) => tx`update public.people set academy_id = ${w.academyB} where id = ${w.personA}`));
    expect(e.code).toBe("42501"); // privilège de colonne absent
  });

  it("un administrateur des deux académies ne peut pas non plus déplacer des données d'un tenant à l'autre", async () => {
    const both = w.alice;
    await adminSql()`insert into public.academy_memberships (academy_id, user_id, role) values (${w.academyB}, ${both.id}, 'admin')`;
    try {
      const e = await failing(() => asUser(both, (tx) => tx`update public.people set academy_id = ${w.academyB} where id = ${w.personA}`));
      expect(e.code).toBe("42501");
    } finally {
      await adminSql()`delete from public.academy_memberships where academy_id = ${w.academyB} and user_id = ${both.id}`;
    }
  });
});

describe("fonctions métier inter-tenant", () => {
  const expectCode = async (fn: () => Promise<unknown>, code: string) => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(code);
      return;
    }
    throw new Error("devait échouer");
  };

  it("inviter, changer un rôle, retirer un membre dans B est refusé", async () => {
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.create_invitation(${w.academyB}, 'x@example.invalid', 'coach', null, ${"c".repeat(64)})`), "forbidden");
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.set_member_role(${w.academyB}, ${w.bob.id}, 'member')`), "forbidden");
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.remove_member(${w.academyB}, ${w.bob.id})`), "not_found");
  });

  it("effacer ou exporter un membre de B répond « introuvable » (pas d'oracle d'existence)", async () => {
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.erase_person(${w.personB}, 'delete')`), "not_found");
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.export_person_data(${w.personB})`), "not_found");
    const [still] = await adminSql()`select 1 from public.people where id = ${w.personB}`;
    expect(still).toBeDefined();
  });

  it("supprimer l'académie B est refusé, journaliser un export sur B aussi", async () => {
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.delete_academy(${w.academyB}, 'Club B')`), "forbidden");
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.record_event(${w.academyB}, 'members.exported', '{}'::jsonb)`), "forbidden");
  });

  it("accepter une invitation de B avec un compte non concerné échoue", async () => {
    await adminSql()`insert into public.invitations (academy_id, email, role, token_hash, expires_at)
      values (${w.academyB}, 'someone-else@example.invalid', 'coach', ${"d".repeat(64)}, now() + interval '1 day')`;
    await expectCode(() => asUser(w.alice, (tx) => tx`select public.accept_invitation(${"d".repeat(64)})`), "invitation_invalid");
    const m = await adminSql()`select 1 from public.academy_memberships where academy_id = ${w.academyB} and user_id = ${w.alice.id}`;
    expect(m).toHaveLength(0);
  });
});

describe("identités forgées et rôles de connexion", () => {
  it("un identifiant utilisateur inconnu ne voit rien", async () => {
    const ghost = { id: "00000000-0000-4000-8000-000000000000" };
    for (const table of TENANT_TABLES) {
      const rows = await asUser(ghost, (tx) => tx.unsafe(`select 1 from public.${table}`));
      expect(rows.length, table).toBe(0);
    }
    expect(await asUser(ghost, (tx) => tx`select 1 from public.academies`)).toHaveLength(0);
  });

  it("une session sans claims (auth.uid() nul) ne voit rien", async () => {
    const rows = await appSql().begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      return tx`select 1 from public.people`;
    });
    expect(rows).toHaveLength(0);
  });

  it("withUser refuse un identifiant mal formé (pas d'injection dans les claims)", async () => {
    await expect(asUser({ id: "x'; drop table public.people; --" }, (tx) => tx`select 1`)).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("le rôle anon n'a aucun accès aux tables", async () => {
    const e = await failing(() =>
      appSql().begin(async (tx) => {
        await tx`select set_config('role', 'anon', true)`;
        return tx`select 1 from public.people`;
      }),
    );
    // app_server n'est pas membre d'anon : SET ROLE refusé ; même membre, aucun privilège de table.
    expect(["42501"]).toContain(e.code);
  });

  it("app_server sans SET ROLE n'a aucun droit sur les tables", async () => {
    for (const table of ["people", "academies", "attendance", "audit_events", "profiles"]) {
      const e = await failing(() => appSql()`select 1 from ${appSql()(`public.${table}`)} limit 1`.catch((err) => { throw err; }));
      expect(e.code, table).toBe("42501");
    }
  });

  it("le rôle authenticated ne peut pas devenir un rôle privilégié", async () => {
    // (app_server peut toujours re-sélectionner son propre rôle de session, mais il n'a aucun droit de table : cf. test précédent.)
    for (const role of ["postgres", "auth_runtime", "anon"]) {
      const e = await failing(() =>
        appSql().begin(async (tx) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe(`set local role ${role}`);
        }),
      );
      expect(e.code, role).toBe("42501");
    }
  });
});
