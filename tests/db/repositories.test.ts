import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeImport, planImport } from "@/domain/csv-import";
import * as academies from "@/server/repositories/academies";
import * as attendance from "@/server/repositories/attendance";
import * as dashboard from "@/server/repositories/dashboard";
import * as members from "@/server/repositories/members";
import * as reports from "@/server/repositories/reports";
import * as schedule from "@/server/repositories/schedule";
import * as team from "@/server/repositories/team";
import { addMember, adminSql, asUser, buildWorld, closeAll, createPerson, createSession, firstClassType, type World } from "./support";

let w: World;
const TZ = "Europe/Paris";
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

describe("members", () => {
  it("crée, liste, recherche (littéralement), modifie, archive et restaure", async () => {
    const id = await asUser(w.alice, (tx) =>
      members.createPerson(tx, w.academyA, { firstName: "Léa", lastName: "Dupont", email: "lea@example.invalid", phone: "+33612345678", joinedOn: "2024-09-02" }),
    );
    const list = await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { q: "dupo", status: "active", page: 1 }));
    expect(list.rows.map((r) => r.id)).toContain(id);
    expect(list.rows[0]?.joinedOn).toBe("2024-09-02"); // date en chaîne, sans décalage de fuseau
    expect(list.rows[0]?.phone).toBe("+33612345678");
    // les jokers LIKE sont littéraux
    expect((await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { q: "%", status: "all", page: 1 }))).rows).toHaveLength(0);
    expect((await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { q: "'; drop table people; --", status: "all", page: 1 }))).total).toBe(0);
    expect(await asUser(w.alice, (tx) => members.updatePerson(tx, w.academyA, id, { firstName: "Léa", lastName: "Durand", email: null, phone: null, joinedOn: null }))).toBe(true);
    expect(await asUser(w.alice, (tx) => members.setPersonArchived(tx, w.academyA, id, true))).toBe(true);
    expect((await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { status: "active", page: 1, q: "durand" }))).total).toBe(0);
    expect((await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { status: "archived", page: 1, q: "durand" }))).total).toBe(1);
    expect(await asUser(w.alice, (tx) => members.setPersonArchived(tx, w.academyA, id, false))).toBe(true);
  });

  it("assiduité de la liste : semaines (lundi local) avec une venue, absences et venues anciennes exclues, colonne optionnelle", async () => {
    const person = await createPerson(w.academyA, "Assidu", "Barrette");
    const recent = await createSession(w.academyA, { startsAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    const old = await createSession(w.academyA, { startsAt: new Date(Date.now() - 80 * 86_400_000).toISOString() });
    const missed = await createSession(w.academyA, { startsAt: new Date(Date.now() - 20 * 86_400_000).toISOString() });
    await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values
      (${w.academyA}, ${recent}, ${person}, 'late'), (${w.academyA}, ${old}, ${person}, 'present'), (${w.academyA}, ${missed}, ${person}, 'absent')`;
    const [expected] = await adminSql()<{ monday: string }[]>`
      select to_char(date_trunc('week', starts_at at time zone ${TZ}), 'YYYY-MM-DD') as monday from public.sessions where id = ${recent}`;
    const withWeeks = await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { q: "barrette", status: "active", page: 1, assiduityTimezone: TZ }));
    expect(withWeeks.rows[0]?.attendedWeeks).toEqual([expected!.monday]);
    const plain = await asUser(w.alice, (tx) => members.listPeople(tx, w.academyA, { q: "barrette", status: "active", page: 1 }));
    expect(plain.rows[0]?.attendedWeeks).toBeUndefined();
  });

  it("une fiche d'une autre académie est introuvable (getPerson / update retournent null/false)", async () => {
    expect(await asUser(w.alice, (tx) => members.getPerson(tx, w.academyA, w.personB))).toBeNull();
    expect(await asUser(w.alice, (tx) => members.getPerson(tx, w.academyB, w.personB))).toBeNull();
    expect(await asUser(w.alice, (tx) => members.updatePerson(tx, w.academyB, w.personB, { firstName: "X", lastName: "Y", email: null, phone: null, joinedOn: null }))).toBe(false);
  });

  it("import : analyse -> plan -> insertion, sans doublons ni double import", async () => {
    const csv = "prénom;nom;email;id\nIvan;Import;ivan@example.invalid;I-1\nIna;Import;;I-2\nAlba;Alpha;alba@example.invalid;I-3\nIvan;Import;ivan@example.invalid;I-4\n";
    const analysis = analyzeImport(csv);
    expect(analysis.rows).toHaveLength(3);
    expect(analysis.duplicatesInFile).toHaveLength(1);
    const run = async () =>
      asUser(w.alice, async (tx) => {
        const existing = await members.findExistingKeys(tx, w.academyA, analysis.rows);
        const plan = planImport(analysis.rows, existing);
        const created = await members.insertImported(tx, w.academyA, plan.toCreate);
        return { plan, created };
      });
    const first = await run();
    expect(first.created).toBe(2);
    expect(first.plan.skippedExisting.map((s) => s.line)).toEqual([4]); // Alba existe déjà (e-mail)
    const second = await run();
    expect(second.created).toBe(0); // idempotent
    expect(second.plan.skippedExisting).toHaveLength(3);
    // insertion directe répétée : ON CONFLICT DO NOTHING protège des courses
    expect(await asUser(w.alice, (tx) => members.insertImported(tx, w.academyA, analysis.rows))).toBe(0);
    // un coach ne peut pas importer pour une autre académie
    await expect(asUser(w.alice, (tx) => members.insertImported(tx, w.academyB, analysis.rows))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("l'import neutralise l'injection SQL dans les valeurs (paramétrage)", async () => {
    const evil = analyzeImport("prenom;nom\nRobert'); DROP TABLE people;--;Tables\n");
    // le nom est rejeté par la validation, et la table survit
    expect(evil.rows).toHaveLength(0);
    expect((await adminSql()`select count(*)::int as n from public.people`)[0]?.n).toBeGreaterThan(0);
  });
});

describe("catalogue, planning, présences", () => {
  it("gère disciplines et types de cours", async () => {
    await asUser(w.alice, (tx) => academies.createDiscipline(tx, w.academyA, "Judo"));
    const disciplines = await asUser(w.alice, (tx) => academies.listDisciplines(tx, w.academyA));
    const judo = disciplines.find((d) => d.name === "Judo")!;
    await asUser(w.alice, (tx) => academies.createClassType(tx, w.academyA, { disciplineId: judo.id, name: "Judo adultes", durationMinutes: 90, capacity: 30 }));
    const types = await asUser(w.alice, (tx) => academies.listClassTypes(tx, w.academyA));
    expect(types.find((t) => t.name === "Judo adultes")).toMatchObject({ durationMinutes: 90, capacity: 30, disciplineName: "Judo" });
    // un type de cours ne peut pas pointer sur une discipline d'une autre académie
    const otherDiscipline = (await asUser(w.bob, (tx) => academies.listDisciplines(tx, w.academyB)))[0]!;
    await expect(
      asUser(w.alice, (tx) => academies.createClassType(tx, w.academyA, { disciplineId: otherDiscipline.id, name: "Intrus", durationMinutes: 60, capacity: null })),
    ).rejects.toBeDefined();
    expect(await asUser(w.alice, (tx) => academies.setDisciplineArchived(tx, w.academyA, judo.id, true))).toBe(true);
    expect((await asUser(w.alice, (tx) => academies.listClassTypes(tx, w.academyA))).find((t) => t.name === "Judo adultes")).toBeUndefined();
    expect((await asUser(w.alice, (tx) => academies.listClassTypes(tx, w.academyA, { includeArchived: true }))).find((t) => t.name === "Judo adultes")).toBeDefined();
  });

  it("crée une récurrence, ignore les créneaux existants, liste par plage locale et gère annulation/suppression", async () => {
    const classTypeId = await firstClassType(w.academyA);
    const input = { classTypeId, instructorId: w.carl.id, dates: ["2027-05-03", "2027-05-05", "2027-05-10"], time: "19:00", durationMinutes: 75, capacity: 25, notes: null };
    expect(await asUser(w.alice, (tx) => schedule.createSessions(tx, w.academyA, input))).toEqual({ created: 3, skipped: 0 });
    expect(await asUser(w.alice, (tx) => schedule.createSessions(tx, w.academyA, input))).toEqual({ created: 0, skipped: 3 });
    const list = await asUser(w.carl, (tx) => schedule.listSessions(tx, w.academyA, TZ, { from: "2027-05-03", to: "2027-05-09" }));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ capacity: 25, status: "scheduled", recorded: 0 });
    expect(list[0]!.endsAt.getTime() - list[0]!.startsAt.getTime()).toBe(75 * 60_000);
    expect(list[0]!.startsAt.toISOString()).toBe("2027-05-03T17:00:00.000Z"); // 19:00 Paris (UTC+2)

    const s = list[0]!;
    expect(await asUser(w.alice, (tx) => schedule.setSessionStatus(tx, w.academyA, s.id, "cancelled"))).toBe(true);
    expect((await asUser(w.alice, (tx) => schedule.getSession(tx, w.academyA, s.id)))?.status).toBe("cancelled");
    expect(await asUser(w.alice, (tx) => schedule.updateSession(tx, w.academyA, s.id, { instructorId: null, date: "2027-05-04", time: "20:00", durationMinutes: 60, capacity: null, notes: "Salle 2" }))).toBe(true);
    expect(await asUser(w.alice, (tx) => schedule.deleteSession(tx, w.academyA, s.id))).toBe(true);
    // un coach ne peut ni créer ni supprimer
    await expect(asUser(w.carl, (tx) => schedule.createSessions(tx, w.academyA, { ...input, dates: ["2027-06-01"] }))).rejects.toMatchObject({ code: "forbidden" });
    expect(await asUser(w.carl, (tx) => schedule.deleteSession(tx, w.academyA, list[1]!.id))).toBe(false);
    // les séances de B sont invisibles
    expect(await asUser(w.alice, (tx) => schedule.getSession(tx, w.academyA, w.sessionB))).toBeNull();
    expect(await asUser(w.alice, (tx) => schedule.listInstructors(tx, w.academyA))).toEqual(expect.arrayContaining([expect.objectContaining({ id: w.carl.id })]));
  });

  it("enregistre, modifie et efface une présence ; feuille d'appel et historique cohérents", async () => {
    const classTypeId = await firstClassType(w.academyA);
    await asUser(w.alice, (tx) => schedule.createSessions(tx, w.academyA, { classTypeId, instructorId: w.carl.id, dates: ["2027-07-01"], time: "18:00", durationMinutes: 60, capacity: null, notes: null }));
    const session = (await asUser(w.alice, (tx) => schedule.listSessions(tx, w.academyA, TZ, { from: "2027-07-01", to: "2027-07-01" })))[0]!;

    expect(await asUser(w.carl, (tx) => attendance.setAttendance(tx, w.academyA, session.id, w.personA, "present"))).toBe(true);
    expect(await asUser(w.carl, (tx) => attendance.setAttendance(tx, w.academyA, session.id, w.personA, "late"))).toBe(true); // modification
    let roster = await asUser(w.carl, (tx) => attendance.getRoster(tx, w.academyA, session.id));
    expect(roster.find((r) => r.personId === w.personA)?.status).toBe("late");
    expect(roster.some((r) => r.personId === w.personB)).toBe(false);
    const marked = await asUser(w.carl, (tx) => attendance.markRemainingPresent(tx, w.academyA, session.id));
    expect(marked).toBeGreaterThan(0);
    roster = await asUser(w.carl, (tx) => attendance.getRoster(tx, w.academyA, session.id));
    expect(roster.every((r) => r.status !== null)).toBe(true);
    expect(roster.find((r) => r.personId === w.personA)?.status).toBe("late"); // pas écrasé

    await asUser(w.carl, (tx) => attendance.setAttendance(tx, w.academyA, session.id, w.personA, null));
    expect((await asUser(w.carl, (tx) => attendance.getRoster(tx, w.academyA, session.id))).find((r) => r.personId === w.personA)?.status).toBeNull();
    await asUser(w.carl, (tx) => attendance.setAttendance(tx, w.academyA, session.id, w.personA, "absent"));

    // membre d'une autre académie : refusé sans effet
    expect(await asUser(w.carl, (tx) => attendance.setAttendance(tx, w.academyA, session.id, w.personB, "present"))).toBe(false);
    const history = await asUser(w.alice, (tx) => attendance.personHistory(tx, w.academyA, w.personA));
    expect(history.some((h) => h.sessionId === session.id && h.status === "absent")).toBe(true);
    const totals = await asUser(w.alice, (tx) => attendance.personTotals(tx, w.academyA, w.personA));
    expect(totals.absent).toBeGreaterThanOrEqual(1);
  });
});

describe("rapports et tableau de bord", () => {
  it("rapport filtré, pagination et export cohérents ; B jamais mélangé", async () => {
    const filters = { from: "2020-01-01", to: "2030-12-31" };
    const report = await asUser(w.alice, (tx) => reports.attendanceReport(tx, w.academyA, TZ, filters, 1));
    expect(report.total).toBeGreaterThan(0);
    expect(report.rows.every((r) => r.personId !== w.personB)).toBe(true);
    expect(report.summary.present + report.summary.late + report.summary.absent).toBe(report.total);
    const forExport = await asUser(w.alice, (tx) => reports.attendanceForExport(tx, w.academyA, TZ, filters));
    expect(forExport).toHaveLength(report.total);
    const filtered = await asUser(w.alice, (tx) => reports.attendanceReport(tx, w.academyA, TZ, { ...filters, personId: w.personA }, 1));
    expect(filtered.rows.every((r) => r.personId === w.personA)).toBe(true);
    // un identifiant de B ne produit rien chez A
    const leak = await asUser(w.alice, (tx) => reports.attendanceReport(tx, w.academyA, TZ, { ...filters, personId: w.personB }, 1));
    expect(leak.total).toBe(0);
  });

  it("tableau de bord : indicateurs issus de la base", async () => {
    const stats = await asUser(w.alice, (tx) => dashboard.getDashboardStats(tx, w.academyA, TZ));
    expect(stats.activeMembers).toBeGreaterThan(0);
    expect(stats.weekly).toHaveLength(8);
    expect(stats.weekly.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.weekStart))).toBe(true);
    const direct = await adminSql()`select count(*)::int as n from public.people where academy_id = ${w.academyA} and archived_at is null and anonymized_at is null`;
    expect(stats.activeMembers).toBe(direct[0]?.n);
    const inactive = await asUser(w.alice, (tx) => dashboard.listInactiveMembers(tx, w.academyA, TZ));
    expect(Array.isArray(inactive)).toBe(true);
  });

  it("détecte séances passées sans présences et membres inactifs", async () => {
    const academy = (await asUser(w.bob, (tx) => academies.listAcademiesForUser(tx, w.bob.id)))[0]!.id;
    const ct = await firstClassType(academy);
    const [person] = await adminSql()<{ id: string }[]>`
      insert into public.people (academy_id, first_name, last_name, joined_on) values (${academy}, 'Inac', 'Tif', '2020-01-01') returning id`;
    await adminSql()`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at)
      values (${academy}, ${ct}, now() - interval '2 days', now() - interval '2 days' + interval '1 hour')`;
    const stats = await asUser(w.bob, (tx) => dashboard.getDashboardStats(tx, academy, TZ));
    expect(stats.pastSessionsWithoutAttendance).toBeGreaterThanOrEqual(1);
    const inactive = await asUser(w.bob, (tx) => dashboard.listInactiveMembers(tx, academy, TZ));
    expect(inactive.map((i) => i.id)).toContain(person!.id);
    expect(inactive.find((i) => i.id === person!.id)).toMatchObject({ email: null }); // lien « Écrire » absent sans e-mail
    const missing = await asUser(w.bob, (tx) => schedule.listSessions(tx, academy, TZ, { from: "2020-01-01", to: "2099-01-01" }, { onlyMissingAttendance: true }));
    expect(missing.length).toBeGreaterThanOrEqual(1);
  });
});

describe("équipe", () => {
  it("liste l'équipe et les invitations, applique rôles et retraits", async () => {
    const t = await asUser(w.alice, (tx) => team.listTeam(tx, w.academyA));
    expect(t.map((m) => m.role)).toEqual(expect.arrayContaining(["owner", "admin", "coach", "member"]));
    const newcomer = await adminSql()<{ id: string }[]>`insert into auth.users (name, email, email_verified) values ('n', ${`n-${Date.now()}@example.invalid`}, true) returning id`;
    await addMember(w.academyA, { id: newcomer[0]!.id, email: "" }, "member");
    await asUser(w.alice, (tx) => team.setMemberRole(tx, w.academyA, newcomer[0]!.id, "coach"));
    await asUser(w.alice, (tx) => team.removeMember(tx, w.academyA, newcomer[0]!.id));
    await asUser(w.alice, (tx) => team.createInvitation(tx, { academyId: w.academyA, email: "x@example.invalid", role: "coach", personId: null, tokenHash: "f".repeat(64) }));
    const invs = await asUser(w.alice, (tx) => team.listInvitations(tx, w.academyA));
    expect(invs.map((i) => i.email)).toContain("x@example.invalid");
    expect(await asUser(w.alice, (tx) => team.revokeInvitation(tx, w.academyA, invs.find((i) => i.email === "x@example.invalid")!.id))).toBe(true);
    const audit = await asUser(w.alice, (tx) => team.listAudit(tx, w.academyA));
    expect(audit.length).toBeGreaterThan(0);
    expect(await asUser(w.carl, (tx) => team.listAudit(tx, w.academyA))).toHaveLength(0);
  });
});
