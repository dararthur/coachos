import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRoster } from "@/server/repositories/attendance";
import { listInactiveMembers } from "@/server/repositories/dashboard";
import { addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing } from "./support";

/** P1.5 : pause déclarée (dont raisons de santé, avec garde-fous RGPD) et motif de départ — migration 000600. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function club(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const coach = await createUser(`${label}-coach`);
  await addMember(academy, coach, "coach");
  const member = async (name: string, withAccount = true) => {
    const user = await createUser(`${label}-${name}`);
    await addMember(academy, user, "member");
    const person = await createPerson(academy, name, "Test");
    if (withAccount) await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
    return { user, person };
  };
  const pauseOf = async (person: string) =>
    (await adminSql()<{ paused_until: string | null; pause_reason: string | null; pause_consent_at: Date | null; pause_set_by: string | null }[]>`
      select paused_until::text, pause_reason, pause_consent_at, pause_set_by from public.people where id = ${person}`)[0]!;
  return { owner, academy, coach, member, pauseOf };
}

describe("pause : règles et consentement", () => {
  it("le staff pose une pause « horaires » sans consentement ; une raison de santé exige le consentement explicite", async () => {
    const c = await club("lc1");
    const m = await c.member("ana");
    await asUser(c.coach, (tx) => tx`select public.set_member_pause(${m.person}, ${inDays(10)}, 'schedule', false)`);
    expect(await c.pauseOf(m.person)).toMatchObject({ pause_reason: "schedule", pause_set_by: "staff", pause_consent_at: null });

    for (const reason of ["injury", "sick"]) {
      const err = await failing(() => asUser(c.coach, (tx) => tx`select public.set_member_pause(${m.person}, ${inDays(10)}, ${reason}, false)`));
      expect(err.message, reason).toMatch(/pause_consent_required|consentement|droits/i);
    }
    expect((await c.pauseOf(m.person)).pause_reason).toBe("schedule"); // rien n'a changé

    await asUser(c.coach, (tx) => tx`select public.set_member_pause(${m.person}, ${inDays(20)}, 'injury', true)`);
    const p = await c.pauseOf(m.person);
    expect(p).toMatchObject({ pause_reason: "injury", pause_set_by: "staff" });
    expect(p.pause_consent_at).not.toBeNull();
  });

  it("refuse une raison inconnue, une date passée ou à plus d'un an ; la base interdit aussi toute écriture directe", async () => {
    const c = await club("lc2");
    const m = await c.member("bob");
    for (const [until, reason] of [[inDays(-1), "other"], [inDays(400), "other"], [inDays(5), "cancer"]] as const) {
      const err = await failing(() => asUser(c.coach, (tx) => tx`select public.set_member_pause(${m.person}, ${until}, ${reason}, true)`));
      expect(err.message, `${until} ${reason}`).toBeTruthy();
    }
    expect((await c.pauseOf(m.person)).pause_reason).toBeNull();
    // Aucune écriture directe sur les colonnes de pause, même pour le propriétaire (colonnes absentes des privilèges).
    const direct = await failing(() => asUser(c.owner, (tx) => tx`update public.people set pause_reason = 'injury', paused_until = ${inDays(3)} where id = ${m.person}`));
    expect(direct.message).toBeTruthy();
    // La contrainte de la base interdit une raison de santé sans consentement, même via un accès direct.
    const sneaky = await failing(() => adminSql()`update public.people set pause_reason = 'injury', paused_until = ${inDays(3)}, pause_set_by = 'staff' where id = ${m.person}`);
    expect(sneaky.message).toMatch(/people_pause_health_consent|violates/i);
  });

  it("l'adhérent pose et lève SA pause, avec consentement pour la santé ; il ne touche jamais celle d'un autre", async () => {
    const c = await club("lc3");
    const ana = await c.member("ana");
    const bob = await c.member("bob");
    const err = await failing(() => asUser(ana.user, (tx) => tx`select public.set_my_pause(${c.academy}, ${inDays(7)}, 'sick', false)`));
    expect(err.message).toBeTruthy();
    await asUser(ana.user, (tx) => tx`select public.set_my_pause(${c.academy}, ${inDays(7)}, 'sick', true)`);
    expect(await c.pauseOf(ana.person)).toMatchObject({ pause_reason: "sick", pause_set_by: "member" });
    expect((await c.pauseOf(bob.person)).pause_reason).toBeNull();

    // Un adhérent ne pose pas la pause d'un autre (fonction réservée au staff : « introuvable »).
    expect((await failing(() => asUser(ana.user, (tx) => tx`select public.set_member_pause(${bob.person}, ${inDays(7)}, 'other', false)`))).message).toBeTruthy();
    await asUser(ana.user, (tx) => tx`select public.clear_my_pause(${c.academy})`);
    expect((await c.pauseOf(ana.person)).pause_reason).toBeNull();
  });
});

describe("« Autre » et « Ne souhaite pas s'exprimer »", () => {
  it("la pause peut être posée sans dire pourquoi (aucun consentement de santé requis), et le motif de départ aussi", async () => {
    const c = await club("lc0");
    const m = await c.member("ana");
    await asUser(m.user, (tx) => tx`select public.set_my_pause(${c.academy}, ${inDays(5)}, 'undisclosed', false)`);
    expect(await c.pauseOf(m.person)).toMatchObject({ pause_reason: "undisclosed", pause_consent_at: null, pause_set_by: "member" });
    await asUser(c.coach, (tx) => tx`select public.set_member_pause(${m.person}, ${inDays(6)}, 'other', false)`);
    expect((await c.pauseOf(m.person)).pause_reason).toBe("other");
    for (const reason of ["other", "undisclosed"]) {
      await asUser(c.owner, (tx) => tx`update public.people set archived_at = now(), departure_reason = ${reason} where id = ${m.person}`);
      const [r] = await adminSql()`select departure_reason from public.people where id = ${m.person}`;
      expect(r!.departure_reason).toBe(reason);
      await asUser(c.owner, (tx) => tx`update public.people set archived_at = null where id = ${m.person}`);
    }
  });
});

describe("feuille d'appel", () => {
  it("la vignette de pause n'est lue que par le staff : la feuille d'appel porte la raison, un adhérent n'y a pas accès", async () => {
    const c = await club("lcr");
    const ana = await c.member("ana");
    const session = await createSession(c.academy);
    await asUser(c.coach, (tx) => tx`select public.set_member_pause(${ana.person}, ${inDays(8)}, 'injury', true)`);
    const roster = await asUser(c.coach, (tx) => getRoster(tx, c.academy, session));
    expect(roster.find((e) => e.personId === ana.person)).toMatchObject({ pauseReason: "injury" });
    // Un adhérent ne voit que sa propre fiche, donc jamais la feuille d'appel des autres.
    const other = await c.member("bob");
    const asMember = await asUser(other.user, (tx) => getRoster(tx, c.academy, session));
    expect(asMember.find((e) => e.personId === ana.person)).toBeUndefined();
  });
});

describe("mineurs", () => {
  it("aucune raison de santé pour un mineur ; « Autre » et « Ne souhaite pas s'exprimer » restent possibles", async () => {
    const c = await club("lcm");
    const child = await c.member("enfant", false);
    await adminSql()`update public.people set birth_date = current_date - 3650, adult_attested_at = null where id = ${child.person}`;
    for (const reason of ["injury", "sick"]) {
      const err = await failing(() => asUser(c.coach, (tx) => tx`select public.set_member_pause(${child.person}, ${inDays(5)}, ${reason}, true)`));
      expect(err.message, reason).toMatch(/mineur|pause_health_minor/i);
    }
    expect((await c.pauseOf(child.person)).pause_reason).toBeNull();
    await asUser(c.coach, (tx) => tx`select public.set_member_pause(${child.person}, ${inDays(5)}, 'undisclosed', false)`);
    expect((await c.pauseOf(child.person)).pause_reason).toBe("undisclosed");
  });
});

describe("pause : qui la voit", () => {
  it("le staff du club et l'adhérent lui-même, jamais un autre adhérent ni un autre club", async () => {
    const c = await club("lc4");
    const other = await club("lc4b");
    const ana = await c.member("ana");
    const bob = await c.member("bob");
    await asUser(ana.user, (tx) => tx`select public.set_my_pause(${c.academy}, ${inDays(7)}, 'injury', true)`);
    const read = (u: { id: string }) => asUser(u, (tx) => tx<{ pause_reason: string | null }[]>`select pause_reason from public.people where id = ${ana.person}`);
    expect((await read(c.owner))[0]?.pause_reason).toBe("injury");
    expect((await read(c.coach))[0]?.pause_reason).toBe("injury");
    expect((await read(ana.user))[0]?.pause_reason).toBe("injury");
    expect(await read(bob.user)).toHaveLength(0); // autre adhérent du même club : la fiche n'est même pas visible
    expect(await read(other.owner)).toHaveLength(0); // autre club
    // Le classement (visible des adhérents) ne renvoie aucune colonne de pause.
    const ranking = await asUser(bob.user, (tx) => tx`select * from public.attendance_ranking(${c.academy}, current_date - 30, current_date)`);
    expect(JSON.stringify(ranking)).not.toMatch(/pause|injury|paused/);
  });

  it("le journal d'audit enregistre qu'une pause a été posée, jamais sa raison", async () => {
    const c = await club("lc5");
    const m = await c.member("ana");
    await asUser(c.coach, (tx) => tx`select public.set_member_pause(${m.person}, ${inDays(7)}, 'injury', true)`);
    const rows = await adminSql()<{ action: string; metadata: unknown }[]>`select action, metadata from public.audit_events where academy_id = ${c.academy} and action like 'member.pause%'`;
    expect(rows.map((r) => r.action)).toEqual(["member.paused"]);
    expect(JSON.stringify(rows)).not.toMatch(/injury|sick|blessure/i);
  });
});

describe("pause : effet, effacement et export", () => {
  it("un membre en pause n'apparaît plus parmi les décrocheurs, et y revient à la reprise", async () => {
    const c = await club("lc6");
    const m = await c.member("ana");
    await adminSql()`update public.people set joined_on = current_date - 90 where id = ${m.person}`;
    const list = () => asUser(c.owner, (tx) => listInactiveMembers(tx, c.academy, "Europe/Paris"));
    expect((await list()).map((x) => x.id)).toContain(m.person);
    await asUser(c.owner, (tx) => tx`select public.set_member_pause(${m.person}, ${inDays(14)}, 'travel', false)`);
    expect((await list()).map((x) => x.id)).not.toContain(m.person);
    await adminSql()`update public.people set paused_until = current_date - 1 where id = ${m.person}`; // reprise passée
    expect((await list()).map((x) => x.id)).toContain(m.person);
  });

  it("archivage et anonymisation lèvent la pause ; la purge efface les pauses finies depuis plus de 30 jours", async () => {
    const c = await club("lc7");
    const a = await c.member("a");
    const b = await c.member("b");
    const old = await c.member("old");
    const recent = await c.member("recent");
    await asUser(c.owner, (tx) => tx`select public.set_member_pause(${a.person}, ${inDays(10)}, 'injury', true)`);
    await asUser(c.owner, (tx) => tx`select public.set_member_pause(${b.person}, ${inDays(10)}, 'sick', true)`);
    await asUser(c.owner, (tx) => tx`update public.people set archived_at = now() where id = ${a.person}`);
    expect(await c.pauseOf(a.person)).toMatchObject({ pause_reason: null, pause_consent_at: null });
    await asUser(c.owner, (tx) => tx`select public.erase_person(${b.person}, 'anonymize')`);
    expect(await c.pauseOf(b.person)).toMatchObject({ pause_reason: null, pause_consent_at: null });

    await adminSql()`update public.people set pause_reason = 'schedule', pause_set_by = 'staff', paused_until = current_date - 31 where id = ${old.person}`;
    await adminSql()`update public.people set pause_reason = 'schedule', pause_set_by = 'staff', paused_until = current_date - 10 where id = ${recent.person}`;
    await appSql()`select app_private.purge_pauses()`;
    expect((await c.pauseOf(old.person)).pause_reason).toBeNull();
    expect((await c.pauseOf(recent.person)).pause_reason).toBe("schedule");
  });

  it("l'export de la personne et l'export du compte contiennent la pause (droit d'accès)", async () => {
    const c = await club("lc8");
    const m = await c.member("ana");
    await asUser(m.user, (tx) => tx`select public.set_my_pause(${c.academy}, ${inDays(9)}, 'injury', true)`);
    const [mine] = await asUser(m.user, (tx) => tx<{ d: { pauses: { pause_reason: string }[] } }[]>`select public.export_my_data() as d`);
    expect(mine!.d.pauses[0]).toMatchObject({ pause_reason: "injury", pause_declared_by: "member" });
    const [staff] = await asUser(c.owner, (tx) => tx<{ d: { pause_and_departure: { pause_reason: string } } }[]>`select public.export_person_data(${m.person}) as d`);
    expect(staff!.d.pause_and_departure.pause_reason).toBe("injury");
  });
});

describe("motif de départ", () => {
  it("liste fermée sans catégorie de santé, posée par un administrateur à l'archivage, effacée à la restauration", async () => {
    const c = await club("lc9");
    const m = await c.member("ana");
    await asUser(c.owner, (tx) => tx`update public.people set archived_at = now(), departure_reason = 'price' where id = ${m.person}`);
    const read = async () => (await adminSql()<{ departure_reason: string | null }[]>`select departure_reason from public.people where id = ${m.person}`)[0]!.departure_reason;
    expect(await read()).toBe("price");
    for (const bad of ["injury", "sick", "blessure", "health"]) {
      expect((await failing(() => asUser(c.owner, (tx) => tx`update public.people set departure_reason = ${bad} where id = ${m.person}`))).message, bad).toBeTruthy();
    }
    await asUser(c.owner, (tx) => tx`update public.people set archived_at = null where id = ${m.person}`);
    expect(await read()).toBeNull();
    // Un coach ne peut pas archiver ni poser de motif (administrateurs seulement).
    const r = await asUser(c.coach, (tx) => tx`update public.people set departure_reason = 'moved' where id = ${m.person}`).catch(() => ({ count: 0 }));
    expect(r.count).toBe(0);
  });
});
