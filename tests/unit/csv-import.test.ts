import { describe, expect, it } from "vitest";
import { analyzeImport, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, nameKey, planImport } from "@/domain/csv-import";

const header = "prénom;nom;email;date_inscription;id";

describe("analyzeImport", () => {
  it("lit un fichier valide (point-virgule, BOM, accents)", () => {
    const csv = `﻿${header}\nÉlodie;Dupont-Martin;ELODIE@Example.invalid;03/09/2024;A1\nJean;O'Neil;;2024-10-01;A2\n`;
    const r = analyzeImport(csv);
    expect(r.fatal).toBeNull();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ firstName: "Élodie", lastName: "Dupont-Martin", email: "elodie@example.invalid", joinedOn: "2024-09-03", externalRef: "A1", line: 2 });
    expect(r.rows[1]).toMatchObject({ email: null, joinedOn: "2024-10-01" });
  });

  it("détecte la virgule et la tabulation", () => {
    expect(analyzeImport("prenom,nom\nAna,Test\n").rows).toHaveLength(1);
    expect(analyzeImport("first_name\tlast_name\nAna\tTest\n").rows).toHaveLength(1);
  });

  it("gère les champs entre guillemets avec virgule, guillemet échappé et saut de ligne", () => {
    const csv = 'prenom,nom,notes\n"Ana Maria","De Souza","a, b ""c""\nd"\n';
    const r = analyzeImport(csv);
    expect(r.invalid).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ firstName: "Ana Maria", lastName: "De Souza" });
    expect(r.ignoredColumns).toEqual(["notes"]);
  });

  it("rejette un fichier trop gros, vide ou binaire", () => {
    expect(analyzeImport("a".repeat(MAX_IMPORT_BYTES + 1)).fatal).toMatch(/volumineux/);
    expect(analyzeImport("   \n").fatal).toMatch(/vide/);
    expect(analyzeImport("prenom;nom\nA\u0000;B\n").fatal).toMatch(/binaires/);
  });

  it("rejette trop de lignes", () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i};N${i}`);
    expect(analyzeImport(`prenom;nom\n${lines.join("\n")}`).fatal).toMatch(/Trop de lignes/);
  });

  it("exige les colonnes prénom et nom et signale les colonnes ignorées", () => {
    expect(analyzeImport("email\na@b.co\n").fatal).toMatch(/introuvables/);
    const r = analyzeImport("prenom;nom;telephone;adresse\nAna;Test;0600000000;1 rue X\n");
    expect(r.ignoredColumns).toEqual(["telephone", "adresse"]);
    expect(r.rows).toHaveLength(1);
  });

  it("refuse les guillemets non fermés au lieu de deviner", () => {
    const r = analyzeImport('prenom,nom\n"Ana,Test\nBob,Test\n');
    expect(r.fatal).toMatch(/Guillemets/);
  });

  it("rejette les lignes avec un nombre de colonnes incohérent", () => {
    const r = analyzeImport("prenom;nom;email\nAna;Test\nBob;Test;b@b.co;extra\n");
    expect(r.rows).toHaveLength(0);
    expect(r.invalid.map((i) => i.line)).toEqual([2, 3]);
  });

  it("rejette l'injection de formule et le HTML dans les noms", () => {
    const r = analyzeImport("prenom;nom;email\n=CMD();Test;\n<script>;Test;\nAna;@evil;\nAna;Ok;+x@y.co\n");
    expect(r.rows).toHaveLength(0);
    expect(r.invalid).toHaveLength(4);
  });

  it("valide strictement les dates (pas de normalisation JS, jour-mois d'abord)", () => {
    const r = analyzeImport("prenom;nom;date_inscription\nA;B;31/02/2024\nC;D;2024-13-01\nE;F;01/02/2024\nG;H;2999-01-01\nI;J;n'importe quoi\n");
    expect(r.rows.map((x) => x.joinedOn)).toEqual(["2024-02-01"]);
    expect(r.invalid.map((i) => i.line)).toEqual([2, 3, 5, 6]);
  });

  it("détecte les doublons internes par e-mail et par identifiant", () => {
    const r = analyzeImport("prenom;nom;email;id\nA;B;a@b.co;1\nC;D;A@B.co;2\nE;F;e@f.co;1\nG;H;g@h.co;3\n");
    expect(r.rows.map((x) => x.line)).toEqual([2, 5]);
    expect(r.duplicatesInFile.map((d) => d.line)).toEqual([3, 4]);
  });

  it("n'accepte pas un e-mail invalide", () => {
    const r = analyzeImport("prenom;nom;email\nA;B;pas-un-email\n");
    expect(r.invalid).toHaveLength(1);
  });
});

describe("planImport", () => {
  const rows = analyzeImport("prenom;nom;email;id\nA;B;a@b.co;1\nC;D;;2\nE;F;;3\nG;H;g@h.co;\n").rows;

  it("ignore les membres existants par e-mail ou identifiant et signale les homonymes", () => {
    const plan = planImport(rows, {
      emails: new Set(["a@b.co"]),
      externalRefs: new Set(["2"]),
      names: new Set([nameKey("E", "F")]),
    });
    expect(plan.skippedExisting.map((s) => s.line)).toEqual([2, 3]);
    expect(plan.toCreate.map((r) => r.line)).toEqual([4, 5]);
    expect(plan.possibleHomonyms.map((s) => s.line)).toEqual([4]);
  });
});
