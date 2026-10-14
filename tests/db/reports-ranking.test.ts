import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendanceCountsForExport } from "@/server/repositories/reports";
import { adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

describe("export du classement par période", () => {
  it("compte les présences (présents et retards) de chaque membre actif sur la plage, avec 0 pour les absents, sans archivés ni anonymisés", async () => {
    const owner = await createUser("rk-owner");
    const academy = await createAcademy(owner, "Club Classement");
    const ana = await createPerson(academy, "Ana", "Alpha");
    const ben = await createPerson(academy, "Ben", "Beta");
    const cleo = await createPerson(academy, "Cléo", "Gamma");
    const archived = await createPerson(academy, "Old", "Delta");

    const day = (iso: string) => createSession(academy, { startsAt: `${iso}T17:00:00Z` });
    const [s1, s2, s3, outside] = [await day("2026-03-02"), await day("2026-03-04"), await day("2026-03-06"), await day("2026-05-01")];
    const mark = (session: string, person: string, status: "present" | "late" | "absent") =>
      adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${session}, ${person}, ${status})`;
    await mark(s1!, ana, "present");
    await mark(s2!, ana, "late");
    await mark(s3!, ana, "present");
    await mark(s1!, ben, "present");
    await mark(s2!, ben, "absent");
    await mark(outside!, cleo, "present"); // hors plage : Cléo reste à 0
    await mark(s1!, archived, "present");
    await adminSql()`update public.people set archived_at = now() where id = ${archived}`; // archivée après coup : exclue du classement

    const rows = await asUser(owner, (tx) => attendanceCountsForExport(tx, academy, "Europe/Paris", { from: "2026-03-01", to: "2026-03-31" }));
    expect(rows.map((r) => [r.firstName, r.present, r.late, r.absent])).toEqual([
      ["Ana", 3, 1, 0],
      ["Ben", 1, 0, 1],
      ["Cléo", 0, 0, 0],
    ]);

    // Les bornes sont incluses : une séance le dernier jour est comptée.
    const rowsEdge = await asUser(owner, (tx) => attendanceCountsForExport(tx, academy, "Europe/Paris", { from: "2026-05-01", to: "2026-05-01" }));
    expect(rowsEdge.find((r) => r.firstName === "Cléo")?.present).toBe(1);
  });

  it("un autre club ne voit rien de ces données (RLS)", async () => {
    const owner = await createUser("rk2-owner");
    const academy = await createAcademy(owner, "Club A Classement");
    await createPerson(academy, "Zoé", "Zeta");
    const other = await createUser("rk2-other");
    const otherAcademy = await createAcademy(other, "Club B Classement");
    const rows = await asUser(other, (tx) => attendanceCountsForExport(tx, academy, "Europe/Paris", { from: "2026-01-01", to: "2026-12-31" }));
    expect(rows).toEqual([]);
    expect(otherAcademy).not.toBe(academy);
  });
});
