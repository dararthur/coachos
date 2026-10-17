import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { can, type Permission, type Role } from "@/domain/roles";
import { AppError } from "@/domain/errors";
import {
  addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing, firstClassType,
  type World,
} from "./support";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

const rolesOf = (w: World): Record<Role, { id: string }> => ({ owner: w.alice, admin: w.adam, coach: w.carl, member: w.mia });

async function allowed(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "not_found")) return false;
    throw e;
  }
}

describe("matrice des permissions : application == base de données", () => {
  const actions: { permission: Permission; run: (w: World, user: { id: string }) => Promise<unknown> }[] = [
    {
      permission: "members.create",
      run: (w, u) => asUser(u, (tx) => tx`insert into public.people (academy_id, first_name, last_name) values (${w.academyA}, 'Nouveau', ${"N" + randomBytes(3).toString("hex")}) returning id`).then((r) => { if (r.length === 0) throw new AppError("forbidden"); }),
    },
    {
      permission: "members.update",
      run: (w, u) => asUser(u, (tx) => tx`update public.people set first_name = 'Alba' where id = ${w.personA}`).then((r) => { if (r.count === 0) throw new AppError("forbidden"); }),
    },
    {
      permission: "members.read",
      run: (w, u) => asUser(u, (tx) => tx`select id from public.people where id = ${w.personA}`).then((r) => { if (r.length === 0) throw new AppError("forbidden"); }),
    },
    {
      permission: "schedule.manage",
      run: async (w, u) => {
        const ct = await firstClassType(w.academyA);
        const start = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 1_000_000) * 60_000);
        const end = new Date(start.getTime() + 3_600_000);
        await asUser(u, (tx) => tx`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at)
          values (${w.academyA}, ${ct}, ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz)`);
      },
    },
    {
      permission: "schedule.read",
      run: (w, u) => asUser(u, (tx) => tx`select id from public.sessions where academy_id = ${w.academyA}`).then((r) => { if (r.length === 0) throw new AppError("forbidden"); }),
    },
    {
      permission: "catalog.manage",
      run: (w, u) => asUser(u, (tx) => tx`insert into public.disciplines (academy_id, name) values (${w.academyA}, ${"Disc " + randomBytes(4).toString("hex")})`),
    },
    {
      permission: "academy.update",
      run: (w, u) => asUser(u, (tx) => tx`update public.academies set locale = 'fr' where id = ${w.academyA}`).then((r) => { if (r.count === 0) throw new AppError("forbidden"); }),
    },
    {
      permission: "news.manage",
      run: (w, u) => asUser(u, (tx) => tx`insert into public.club_posts (academy_id, title, body) values (${w.academyA}, 'Annonce', 'Texte')`),
    },
    {
      permission: "audit.read",
      run: (w, u) => asUser(u, (tx) => tx`select id from public.audit_events where academy_id = ${w.academyA}`).then((r) => { if (r.length === 0) throw new AppError("forbidden"); }),
    },
    {
      permission: "team.manage",
      run: (w, u) => asUser(u, (tx) => tx`select public.create_invitation(${w.academyA}, ${"m" + randomBytes(3).toString("hex") + "@example.invalid"}, 'coach', null, ${createHash("sha256").update(randomBytes(8)).digest("hex")})`),
    },
    {
      permission: "attendance.record",
      run: (w, u) => asUser(u, (tx) => tx`update public.attendance set status = 'present' where session_id = ${w.sessionA} and person_id = ${w.personA}`).then((r) => { if (r.count === 0) throw new AppError("forbidden"); }),
    },
  ];

  for (const action of actions) {
    it(`${action.permission}`, async () => {
      for (const [role, user] of Object.entries(rolesOf(w)) as [Role, { id: string }][]) {
        const ok = await allowed(() => action.run(w, user));
        expect(ok, `${role} / ${action.permission} : la base ${ok ? "autorise" : "refuse"}`).toBe(can(role, action.permission));
      }
    });
  }

  it("academy.delete : réservé au propriétaire (et exige le nom exact)", async () => {
    const temp = await createUser("tmp-owner");
    const academy = await createAcademy(temp, "Club jetable");
    await addMember(academy, w.adam, "admin");
    expect(await allowed(() => asUser(w.adam, (tx) => tx`select public.delete_academy(${academy}, 'Club jetable')`))).toBe(false);
    await expect(asUser(temp, (tx) => tx`select public.delete_academy(${academy}, 'Autre nom')`)).rejects.toMatchObject({ code: "confirmation_mismatch" });
    await asUser(temp, (tx) => tx`select public.delete_academy(${academy}, 'Club jetable')`);
    expect(await adminSql()`select 1 from public.academies where id = ${academy}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.sessions where academy_id = ${academy}`).toHaveLength(0);
  });
});

describe("présences : portée du coach et du membre", () => {
  it("un coach enregistre les présences de ses séances, pas celles d'un autre coach", async () => {
    const other = await createUser("coach2");
    await addMember(w.academyA, other, "coach");
    const mine = await createSession(w.academyA, { instructor: w.carl.id });
    const theirs = await createSession(w.academyA, { instructor: other.id });
    const unassigned = await createSession(w.academyA, { instructor: null });
    const person = await createPerson(w.academyA, "Pat", "Present");

    const ins = (session: string) =>
      asUser(w.carl, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${session}, ${person}, 'present')`);
    await ins(mine);
    await ins(unassigned);
    await expect(ins(theirs)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("un membre ne lit que ses propres présences et ne peut rien écrire", async () => {
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status)
      values (${w.academyA}, ${w.sessionA}, ${w.miaPerson}, 'present') on conflict do nothing`;
    const own = await asUser(w.mia, (tx) => tx`select person_id from public.attendance`);
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((r) => r.person_id))).toEqual(new Set([w.miaPerson]));
    const people = await asUser(w.mia, (tx) => tx`select id from public.people`);
    expect(people.map((p) => p.id)).toEqual([w.miaPerson]);
    await expect(
      asUser(w.mia, (tx) => tx`update public.attendance set status = 'absent' where person_id = ${w.miaPerson}`).then((r) => { if (r.count === 0) throw new AppError("forbidden"); }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuse les présences sur séance annulée et sur membre archivé ou anonymisé", async () => {
    const cancelled = await createSession(w.academyA, { status: "cancelled" });
    const archived = await createPerson(w.academyA, "Arch", "Ivé");
    await adminSql()`update public.people set archived_at = now() where id = ${archived}`;
    const person = await createPerson(w.academyA, "Ok", "Ok");
    await expect(
      asUser(w.alice, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${cancelled}, ${person}, 'present')`),
    ).rejects.toMatchObject({ code: "session_cancelled" });
    await expect(
      asUser(w.alice, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${w.sessionA}, ${archived}, 'present')`),
    ).rejects.toMatchObject({ code: "person_archived" });
  });

  it("une seule présence par membre et par séance ; l'auteur est imposé par la base", async () => {
    const person = await createPerson(w.academyA, "Uni", "Que");
    const ins = () =>
      asUser(w.alice, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${w.sessionA}, ${person}, 'present')`);
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: "duplicate" });
    const [row] = await adminSql()<{ recorded_by: string }[]>`select recorded_by from public.attendance where person_id = ${person}`;
    expect(row?.recorded_by).toBe(w.alice.id);
  });

  it("une séance qui contient des présences ne peut pas être supprimée", async () => {
    await expect(asUser(w.alice, (tx) => tx`delete from public.sessions where id = ${w.sessionA}`)).rejects.toMatchObject({ code: "session_has_attendance" });
  });
});

describe("séances et fuseaux", () => {
  it("la création en lot respecte le fuseau de l'académie, y compris au changement d'heure", async () => {
    const ct = await firstClassType(w.academyA);
    const rows = [{ date: "2027-03-27", time: "18:30" }, { date: "2027-03-29", time: "18:30" }];
    await asUser(w.alice, (tx) => tx`
      insert into public.sessions (academy_id, class_type_id, starts_at, ends_at)
      select a.id, ${ct}, (d.date + d.time) at time zone a.timezone, (d.date + d.time) at time zone a.timezone + interval '1 hour'
      from public.academies a, jsonb_to_recordset(${tx.json(rows)}::jsonb) as d(date date, time time)
      where a.id = ${w.academyA}`);
    const out = await adminSql()<{ starts_at: Date }[]>`
      select starts_at from public.sessions where academy_id = ${w.academyA} and starts_at >= '2027-03-27' and starts_at < '2027-03-30' order by starts_at`;
    // Paris : UTC+1 avant le 28 mars 2027, UTC+2 ensuite (heure d'été).
    expect(out.map((r) => r.starts_at.toISOString())).toEqual(["2027-03-27T17:30:00.000Z", "2027-03-29T16:30:00.000Z"]);
  });

  it("empêche les doublons de créneau, les durées incohérentes et les coachs étrangers", async () => {
    const ct = await firstClassType(w.academyA);
    const mk = (start: string, end: string, instructor: string | null = null) =>
      asUser(w.alice, (tx) => tx`insert into public.sessions (academy_id, class_type_id, instructor_id, starts_at, ends_at)
        values (${w.academyA}, ${ct}, ${instructor}, ${start}::timestamptz, ${end}::timestamptz)`);
    await mk("2028-01-10T18:00:00Z", "2028-01-10T19:00:00Z");
    await expect(mk("2028-01-10T18:00:00Z", "2028-01-10T19:00:00Z")).rejects.toMatchObject({ code: "duplicate" });
    await expect(mk("2028-01-11T18:00:00Z", "2028-01-11T17:00:00Z")).rejects.toMatchObject({ code: "validation" });
    await expect(mk("2028-01-12T08:00:00Z", "2028-01-12T22:00:00Z")).rejects.toMatchObject({ code: "validation" });
    await expect(mk("2028-01-13T18:00:00Z", "2028-01-13T19:00:00Z", w.bob.id)).rejects.toBeInstanceOf(AppError); // coach d'une autre académie
    await expect(mk("2028-01-14T18:00:00Z", "2028-01-14T19:00:00Z", w.mia.id)).rejects.toMatchObject({ code: "invalid_instructor" }); // simple membre
  });
});

describe("équipe et invitations", () => {
  const token = () => randomBytes(32).toString("base64url");
  const hash = (t: string) => createHash("sha256").update(t).digest("hex");

  it("flux complet : invitation -> acceptation par la bonne adresse e-mail confirmée", async () => {
    const invitee = await createUser("nouveau-coach");
    const t = token();
    await asUser(w.alice, (tx) => tx`select public.create_invitation(${w.academyA}, ${invitee.email.toUpperCase()}, 'coach', null, ${hash(t)})`);
    // le jeton en clair n'est jamais stocké
    const stored = await adminSql()<{ token_hash: string }[]>`select token_hash from public.invitations where email = ${invitee.email}`;
    expect(stored[0]?.token_hash).toBe(hash(t));
    expect(JSON.stringify(stored)).not.toContain(t);

    const intruder = await createUser("intrus");
    await expect(asUser(intruder, (tx) => tx`select public.accept_invitation(${hash(t)})`)).rejects.toMatchObject({ code: "invitation_invalid" });
    const [academy] = await asUser(invitee, (tx) => tx<{ a: string }[]>`select public.accept_invitation(${hash(t)}) as a`);
    expect(academy?.a).toBe(w.academyA);
    await expect(asUser(invitee, (tx) => tx`select public.accept_invitation(${hash(t)})`)).rejects.toMatchObject({ code: "invitation_invalid" }); // usage unique
    const [m] = await adminSql()<{ role: string }[]>`select role from public.academy_memberships where user_id = ${invitee.id} and academy_id = ${w.academyA}`;
    expect(m?.role).toBe("coach");
  });

  it("refuse l'acceptation si l'e-mail du compte n'est pas confirmé ou si l'invitation a expiré", async () => {
    const unconfirmed = await createUser("non-confirme", false);
    const t = token();
    await asUser(w.alice, (tx) => tx`select public.create_invitation(${w.academyA}, ${unconfirmed.email}, 'member', null, ${hash(t)})`);
    await expect(asUser(unconfirmed, (tx) => tx`select public.accept_invitation(${hash(t)})`)).rejects.toMatchObject({ code: "email_not_confirmed" });

    const late = await createUser("tardif");
    const t2 = token();
    await asUser(w.alice, (tx) => tx`select public.create_invitation(${w.academyA}, ${late.email}, 'member', null, ${hash(t2)})`);
    await adminSql()`update public.invitations set expires_at = now() - interval '1 minute' where token_hash = ${hash(t2)}`;
    await expect(asUser(late, (tx) => tx`select public.accept_invitation(${hash(t2)})`)).rejects.toMatchObject({ code: "invitation_invalid" });
  });

  it("un compte déjà dans le club prend le rôle de l'invitation s'il est plus élevé, jamais un rôle inférieur", async () => {
    const role = async (u: { id: string }) => (await adminSql()<{ role: string }[]>`select role from public.academy_memberships where user_id = ${u.id} and academy_id = ${w.academyA}`)[0]?.role;
    const invite = async (u: { email: string }, r: string) => {
      const t = token();
      await asUser(w.alice, (tx) => tx`select public.create_invitation(${w.academyA}, ${u.email}, ${r}, null, ${hash(t)})`);
      return t;
    };
    // Un adhérent devient coach en acceptant l'invitation « coach » (avant : invitation consommée, rôle inchangé).
    const promoted = await createUser("membre-promu");
    await addMember(w.academyA, promoted, "member");
    await asUser(promoted, async (tx) => tx`select public.accept_invitation(${hash(await invite(promoted, "coach"))})`);
    expect(await role(promoted)).toBe("coach");
    // Un administrateur qui accepte une invitation « membre » reste administrateur.
    const admin = await createUser("admin-garde");
    await addMember(w.academyA, admin, "admin");
    await asUser(admin, async (tx) => tx`select public.accept_invitation(${hash(await invite(admin, "member"))})`);
    expect(await role(admin)).toBe("admin");
  });

  it("une invitation « membre » peut lier le compte à une fiche existante", async () => {
    const user = await createUser("lie");
    const person = await createPerson(w.academyA, "Lie", "Fiche");
    const t = token();
    await asUser(w.alice, (tx) => tx`select public.create_invitation(${w.academyA}, ${user.email}, 'member', ${person}, ${hash(t)})`);
    await asUser(user, (tx) => tx`select public.accept_invitation(${hash(t)})`);
    const [p] = await adminSql()<{ user_id: string }[]>`select user_id from public.people where id = ${person}`;
    expect(p?.user_id).toBe(user.id);
    // le membre voit sa fiche et elle seule
    const seen = await asUser(user, (tx) => tx`select id from public.people`);
    expect(seen.map((r) => r.id)).toEqual([person]);
  });

  it("hiérarchie : un admin ne nomme ni n'invite d'admin ; le dernier propriétaire est protégé", async () => {
    await expect(asUser(w.adam, (tx) => tx`select public.create_invitation(${w.academyA}, 'a@example.invalid', 'admin', null, ${hash(token())})`)).rejects.toMatchObject({ code: "forbidden" });
    await expect(asUser(w.adam, (tx) => tx`select public.set_member_role(${w.academyA}, ${w.carl.id}, 'admin')`)).rejects.toMatchObject({ code: "forbidden" });
    await expect(asUser(w.adam, (tx) => tx`select public.set_member_role(${w.academyA}, ${w.alice.id}, 'member')`)).rejects.toMatchObject({ code: "forbidden" });
    await expect(asUser(w.adam, (tx) => tx`select public.remove_member(${w.academyA}, ${w.alice.id})`)).rejects.toMatchObject({ code: "forbidden" });
    await expect(asUser(w.carl, (tx) => tx`select public.set_member_role(${w.academyA}, ${w.mia.id}, 'coach')`)).rejects.toMatchObject({ code: "forbidden" });
    await expect(asUser(w.alice, (tx) => tx`select public.set_member_role(${w.academyA}, ${w.alice.id}, 'admin')`)).rejects.toMatchObject({ code: "last_owner" });
    await expect(asUser(w.alice, (tx) => tx`select public.remove_member(${w.academyA}, ${w.alice.id})`)).rejects.toMatchObject({ code: "last_owner" });
  });

  it("un coach retiré libère ses séances (sans coach) et son lien de fiche", async () => {
    const leaving = await createUser("partant");
    await addMember(w.academyA, leaving, "coach");
    const session = await createSession(w.academyA, { instructor: leaving.id });
    await asUser(w.alice, (tx) => tx`select public.remove_member(${w.academyA}, ${leaving.id})`);
    const [s] = await adminSql()<{ instructor_id: string | null; academy_id: string }[]>`select instructor_id, academy_id from public.sessions where id = ${session}`;
    expect(s).toMatchObject({ instructor_id: null, academy_id: w.academyA });
  });

  it("les actions d'équipe sont journalisées sans donnée personnelle", async () => {
    const rows = await adminSql()<{ action: string; metadata: unknown }[]>`select action, metadata from public.audit_events where academy_id = ${w.academyA}`;
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["academy.created", "team.invited", "team.joined", "team.removed"]));
    expect(JSON.stringify(rows)).not.toMatch(/@example\.invalid/);
  });
});

describe("création d'académie", () => {
  it("amorce des disciplines, rend le créateur propriétaire et plafonne le nombre d'académies", async () => {
    const u = await createUser("fondateur");
    const id = await createAcademy(u, "Mon club");
    const disciplines = await adminSql()<{ name: string }[]>`select name from public.disciplines where academy_id = ${id} order by name`;
    expect(disciplines.map((d) => d.name)).toEqual(["Grappling", "Jiu-Jitsu Brésilien", "MMA"]);
    const [m] = await adminSql()<{ role: string }[]>`select role from public.academy_memberships where academy_id = ${id} and user_id = ${u.id}`;
    expect(m?.role).toBe("owner");
    for (let i = 0; i < 4; i++) await createAcademy(u, `Club ${i}`);
    expect((await failing(() => createAcademy(u, "Un de trop"))).message).toContain("coachos:academy_limit_reached");
  });

  it("refuse un fuseau horaire inconnu et un nom trop court", async () => {
    const u = await createUser("tz");
    expect((await failing(() => adminSql()`select app_private.create_academy_for(${u.id}, 'Club', 'Mars/Olympus', 'EUR')`)).message).toContain("coachos:invalid_timezone");
    expect((await failing(() => adminSql()`select app_private.create_academy_for(${u.id}, 'X', 'Europe/Paris', 'EUR')`)).message).toMatch(/check constraint|coachos:validation/);
  });

  it("les fiches membres respectent l'unicité d'e-mail et d'identifiant par académie, pas entre académies", async () => {
    const mk = (academy: string, email: string, ref: string | null) =>
      asUser(academy === w.academyA ? w.alice : w.bob, (tx) => tx`insert into public.people (academy_id, first_name, last_name, email, external_ref) values (${academy}, 'Z', 'Z', ${email}, ${ref})`);
    await mk(w.academyA, "dup@example.invalid", "R-1");
    await expect(mk(w.academyA, "DUP@example.invalid", null)).rejects.toMatchObject({ code: "duplicate" });
    await expect(mk(w.academyA, "autre@example.invalid", "R-1")).rejects.toMatchObject({ code: "duplicate" });
    await mk(w.academyB, "dup@example.invalid", "R-1"); // même valeurs dans un autre club : autorisé
  });

  it("l'attestation de majorité est horodatée par la base et les identités forgées sont ignorées", async () => {
    const [p] = await asUser(w.alice, (tx) => tx<{ id: string; created_by: string; adult_attested_at: Date }[]>`
      insert into public.people (academy_id, first_name, last_name) values (${w.academyA}, 'Att', 'Este') returning id, created_by, adult_attested_at`);
    expect(p?.created_by).toBe(w.alice.id);
    expect(p?.adult_attested_at).toBeInstanceOf(Date);
    const e = await failing(() => asUser(w.alice, (tx) => tx`insert into public.people (academy_id, first_name, last_name, created_by) values (${w.academyA}, 'F', 'G', ${w.bob.id})`));
    expect(e.code).toBe("42501"); // created_by non insérable par le client
  });
});
