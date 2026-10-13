import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isoWeekday, isValidTimeZone, localDate, parseCalendarDate } from "@/domain/dates";
import { csvCell, safeFilename, toCsv } from "@/domain/csv-export";
import { expandOccurrences } from "@/domain/schedule";
import { assignableRoles, can, canManageMember, PERMISSIONS, ROLES } from "@/domain/roles";
import {
  academySchema, attendanceSchema, formToObject, invitationSchema, MAX_OCCURRENCES, parseWith, personCreateSchema,
  recurrenceLimit, reportFilterSchema, sessionCreateSchema, signupSchema,
} from "@/domain/validation";

describe("dates", () => {
  it("parse strictement ISO et JJ/MM/AAAA", () => {
    expect(parseCalendarDate("2024-02-29")).toBe("2024-02-29");
    expect(parseCalendarDate("2023-02-29")).toBeNull();
    expect(parseCalendarDate("3/9/2024")).toBe("2024-09-03"); // jour d'abord, jamais mois d'abord
    expect(parseCalendarDate("12.12.2024")).toBe("2024-12-12");
    expect(parseCalendarDate("31/04/2024")).toBeNull();
    expect(parseCalendarDate("2024/01/01")).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
    expect(parseCalendarDate("1800-01-01")).toBeNull();
  });
  it("calcule jours ouvrés ISO et décalages", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // lundi
    expect(isoWeekday("2026-10-18")).toBe(7); // dimanche
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-13", "2026-10-20")).toBe(7);
  });
  it("gère les fuseaux (minuit local ≠ minuit UTC)", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(localDate(new Date("2026-10-13T22:30:00Z"), "Europe/Paris")).toBe("2026-10-14");
    expect(localDate(new Date("2026-10-13T22:30:00Z"), "UTC")).toBe("2026-10-13");
  });
});

describe("export CSV", () => {
  it("échappe guillemets, séparateurs et sauts de ligne", () => {
    expect(csvCell('a"b;c\nd')).toBe('"a""b;c\nd"');
  });
  it("neutralise l'injection de formules", () => {
    for (const evil of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) {
      expect(csvCell(evil)).toBe(`"'${evil}"`);
    }
    expect(csvCell(-3)).toBe("-3");
  });
  it("produit BOM, CRLF et en-têtes", () => {
    const out = toCsv(["a", "b"], [["x", 1], [null, undefined]]);
    expect(out.startsWith("﻿\"a\";\"b\"\r\n")).toBe(true);
    expect(out.endsWith("\"x\";1\r\n;\r\n")).toBe(true);
  });
  it("assainit les noms de fichier", () => {
    expect(safeFilename("Académie \"X\"/../é", "csv")).toBe("Academie-X-.-e.csv");
  });
});

describe("récurrence", () => {
  it("une séance unique", () => {
    expect(expandOccurrences({ date: "2026-10-13", repeat: "none", weekdays: [] })).toEqual(["2026-10-13"]);
  });
  it("hebdomadaire lundi/mercredi", () => {
    const d = expandOccurrences({ date: "2026-10-12", repeat: "weekly", weekdays: [1, 3], until: "2026-10-25" });
    expect(d).toEqual(["2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21"]);
  });
  it("plafonne le nombre d'occurrences pour détecter l'excès", () => {
    // Une année complète, tous les jours, tient dans le plafond…
    expect(expandOccurrences({ date: "2028-01-01", repeat: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7], until: "2028-12-31" })).toHaveLength(366);
    // …au-delà, la liste s'arrête à MAX + 1 pour signaler l'excès.
    const d = expandOccurrences({ date: "2026-01-01", repeat: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7], until: "2027-12-31" });
    expect(d.length).toBe(MAX_OCCURRENCES + 1);
  });
});

describe("permissions", () => {
  it("le membre n'a aucun droit de gestion", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      if (p !== "schedule.read") expect(can("member", p)).toBe(false);
    }
    expect(can(null, "schedule.read")).toBe(false);
  });
  it("seul le propriétaire supprime l'académie", () => {
    expect(ROLES.filter((r) => can(r, "academy.delete"))).toEqual(["owner"]);
  });
  it("hiérarchie de gestion d'équipe", () => {
    expect(assignableRoles("admin")).toEqual(["coach", "member"]);
    expect(assignableRoles("coach")).toEqual([]);
    expect(canManageMember("admin", "admin")).toBe(false);
    expect(canManageMember("owner", "owner")).toBe(true);
  });
});

describe("validation", () => {
  it("inscription : mot de passe 12 caractères mini", () => {
    expect(parseWith(signupSchema, { email: "a@b.co", password: "court" }).ok).toBe(false);
    expect(parseWith(signupSchema, { email: " A@B.co ", password: "un-mot-de-passe-long" })).toMatchObject({ ok: true, data: { email: "a@b.co" } });
  });
  it("académie : fuseau et devise contrôlés", () => {
    expect(parseWith(academySchema, { name: "Club", timezone: "Europe/Paris", currency: "EUR" }).ok).toBe(true);
    expect(parseWith(academySchema, { name: "Club", timezone: "Nope", currency: "EUR" }).ok).toBe(false);
    expect(parseWith(academySchema, { name: "<b>x</b>", timezone: "Europe/Paris", currency: "EUR" }).ok).toBe(false);
  });
  it("membre : attestation de majorité obligatoire", () => {
    const base = { firstName: "Ana", lastName: "Test", email: "", joinedOn: "" };
    expect(parseWith(personCreateSchema, base).ok).toBe(false);
    expect(parseWith(personCreateSchema, { ...base, adultConfirmed: "on" }).ok).toBe(true);
  });
  it("séance récurrente : bornes et jours", () => {
    const base = { classTypeId: crypto.randomUUID(), date: "2026-10-12", time: "18:30", durationMinutes: "60", repeat: "weekly", weekdays: ["1", "3"] };
    expect(parseWith(sessionCreateSchema, { ...base, until: "2026-12-20" }).ok).toBe(true);
    expect(parseWith(sessionCreateSchema, { ...base }).ok).toBe(false);
    expect(parseWith(sessionCreateSchema, { ...base, until: "2028-12-20" }).ok).toBe(false);
    // Limite : 31 décembre de l'année de la première séance (au lieu de 6 mois).
    expect(recurrenceLimit("2026-10-12")).toBe("2026-12-31");
    expect(parseWith(sessionCreateSchema, { ...base, until: "2026-12-31" }).ok).toBe(true);
    expect(parseWith(sessionCreateSchema, { ...base, until: "2027-01-01" }).ok).toBe(false);
    expect(parseWith(sessionCreateSchema, { ...base, date: "2027-01-04", until: "2027-11-30" }).ok).toBe(true); // > 6 mois, même année
    expect(parseWith(sessionCreateSchema, { ...base, until: "2026-12-20", weekdays: [] }).ok).toBe(false);
    expect(parseWith(sessionCreateSchema, { ...base, until: "2026-12-20", time: "25:00" }).ok).toBe(false);
  });
  it("présence : statuts autorisés uniquement", () => {
    const ids = { sessionId: crypto.randomUUID(), personId: crypto.randomUUID() };
    expect(parseWith(attendanceSchema, { ...ids, status: "present" }).ok).toBe(true);
    expect(parseWith(attendanceSchema, { ...ids, status: "excused" }).ok).toBe(false);
    expect(parseWith(attendanceSchema, { sessionId: "1' or '1'='1", personId: ids.personId, status: "none" }).ok).toBe(false);
  });
  it("invitation : le rôle owner ne s'invite pas", () => {
    expect(parseWith(invitationSchema, { email: "a@b.co", role: "owner" }).ok).toBe(false);
  });
  it("rapport : période limitée à 12 mois", () => {
    expect(parseWith(reportFilterSchema, { from: "2026-01-01", to: "2026-06-01" }).ok).toBe(true);
    expect(parseWith(reportFilterSchema, { from: "2024-01-01", to: "2026-06-01" }).ok).toBe(false);
    expect(parseWith(reportFilterSchema, { from: "2026-06-01", to: "2026-01-01" }).ok).toBe(false);
  });
  it("formToObject regroupe les clés répétées et ignore les métadonnées d'action", () => {
    const fd = new FormData();
    fd.append("weekdays", "1");
    fd.append("weekdays", "3");
    fd.append("name", "x");
    fd.append("$ACTION_ID_abc", "");
    expect(formToObject(fd)).toEqual({ weekdays: ["1", "3"], name: "x" });
  });
});
