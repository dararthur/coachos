import Papa from "papaparse";
import { z } from "zod";
import { parseCalendarDate } from "./dates";
import { emailField, nameField, parseWith } from "./validation";

/** Limites défensives de l'import. */
export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ROWS = 2_000;

export interface ImportRow {
  line: number;
  firstName: string;
  lastName: string;
  email: string | null;
  joinedOn: string | null;
  externalRef: string | null;
}

export interface RowIssue {
  line: number;
  messages: string[];
}

export interface ImportAnalysis {
  /** Erreur bloquante : aucun import possible. */
  fatal: string | null;
  totalRows: number;
  rows: ImportRow[];
  invalid: RowIssue[];
  duplicatesInFile: RowIssue[];
  ignoredColumns: string[];
}

type Field = "firstName" | "lastName" | "email" | "joinedOn" | "externalRef";

// Alias normalisés (minuscules, sans accent, séparateurs -> « _ »).
const COLUMN_ALIASES: Record<Field, string[]> = {
  firstName: ["prenom", "first_name", "firstname", "given_name"],
  lastName: ["nom", "nom_de_famille", "last_name", "lastname", "surname", "family_name"],
  email: ["email", "e_mail", "mail", "courriel", "adresse_email", "adresse_e_mail"],
  joinedOn: ["date_inscription", "inscription", "date_d_inscription", "joined_on", "join_date", "membre_depuis", "start_date"],
  externalRef: ["id", "identifiant", "reference", "ref", "external_id", "external_ref", "member_id", "numero_membre"],
};

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const FORMULA_START = /^[=+\-@]/;

const rowSchema = z.object({
  firstName: nameField("Prénom"),
  lastName: nameField("Nom"),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), emailField.optional()),
  externalRef: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,99}$/, "Identifiant : lettres, chiffres et . _ : / # - uniquement.").optional(),
  ),
});

function fatal(message: string, extra: Partial<ImportAnalysis> = {}): ImportAnalysis {
  return { fatal: message, totalRows: 0, rows: [], invalid: [], duplicatesInFile: [], ignoredColumns: [], ...extra };
}

/**
 * Analyse défensive d'un export CSV de membres. Pure : ne touche ni la base ni le disque.
 * Rien n'est jamais « corrigé en silence » : toute ligne douteuse est rejetée avec sa raison.
 */
export function analyzeImport(input: string): ImportAnalysis {
  const bytes = new TextEncoder().encode(input).length;
  if (bytes > MAX_IMPORT_BYTES) return fatal(`Fichier trop volumineux (${Math.round(MAX_IMPORT_BYTES / 1000)} Ko maximum).`);
  const text = input.replace(/^﻿/, "");
  if (text.includes("\u0000")) return fatal("Le fichier contient des caractères binaires : ce n'est pas un CSV texte valide.");
  if (text.trim() === "") return fatal("Le fichier est vide.");

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
  });

  const quoteError = parsed.errors.find((e) => e.type === "Quotes");
  if (quoteError) {
    return fatal(`Guillemets mal formés (ligne ${(quoteError.row ?? 0) + 2}). Corrigez le fichier avant l'import.`);
  }

  const [headerRow, ...dataRows] = parsed.data;
  if (!headerRow || dataRows.length === 0) return fatal("Le fichier doit contenir une ligne d'en-têtes puis au moins un membre.");
  if (dataRows.length > MAX_IMPORT_ROWS) return fatal(`Trop de lignes (${MAX_IMPORT_ROWS} maximum par import).`);

  const normalized = headerRow.map(normalizeHeader);
  const columnOf = {} as Record<Field, number>;
  const used = new Set<number>();
  for (const field of Object.keys(COLUMN_ALIASES) as Field[]) {
    const index = normalized.findIndex((h, i) => !used.has(i) && COLUMN_ALIASES[field].includes(h));
    if (index >= 0) {
      columnOf[field] = index;
      used.add(index);
    }
  }
  if (columnOf.firstName === undefined || columnOf.lastName === undefined) {
    return fatal("Colonnes « prénom » et « nom » introuvables. En-têtes acceptés : prénom/first_name et nom/last_name.");
  }
  const ignoredColumns = headerRow.filter((_, i) => !used.has(i)).map((h) => h.trim()).filter(Boolean);

  const rows: ImportRow[] = [];
  const invalid: RowIssue[] = [];
  const duplicatesInFile: RowIssue[] = [];
  const seenEmails = new Map<string, number>();
  const seenRefs = new Map<string, number>();

  dataRows.forEach((cells, index) => {
    const line = index + 2; // 1 = en-têtes
    if (cells.length !== headerRow.length) {
      invalid.push({ line, messages: [`Nombre de colonnes incorrect (${cells.length} au lieu de ${headerRow.length}).`] });
      return;
    }
    const get = (field: Field) => (columnOf[field] === undefined ? "" : (cells[columnOf[field]] ?? "").trim());
    const messages: string[] = [];

    for (const field of Object.keys(COLUMN_ALIASES) as Field[]) {
      const value = get(field);
      if (CONTROL_CHARS.test(value)) messages.push("Caractère de contrôle interdit.");
      else if (value && FORMULA_START.test(value) && field !== "joinedOn") messages.push("Une valeur ne peut pas commencer par = + - ou @.");
    }

    const checked = parseWith(rowSchema, {
      firstName: get("firstName"),
      lastName: get("lastName"),
      email: get("email"),
      externalRef: get("externalRef"),
    });
    if (!checked.ok) messages.push(...Object.values(checked.fieldErrors));

    const rawDate = get("joinedOn");
    let joinedOn: string | null = null;
    if (rawDate) {
      joinedOn = parseCalendarDate(rawDate);
      if (!joinedOn) messages.push("Date d'inscription invalide (formats : AAAA-MM-JJ ou JJ/MM/AAAA).");
      else if (joinedOn > new Date().toISOString().slice(0, 10)) messages.push("Date d'inscription dans le futur.");
    }

    if (messages.length > 0 || !checked.ok) {
      invalid.push({ line, messages: [...new Set(messages)] });
      return;
    }
    const { firstName, lastName, email, externalRef } = checked.data;

    const dupMessages: string[] = [];
    if (email) {
      const first = seenEmails.get(email);
      if (first) dupMessages.push(`Même e-mail que la ligne ${first}.`);
      else seenEmails.set(email, line);
    }
    if (externalRef) {
      const first = seenRefs.get(externalRef);
      if (first) dupMessages.push(`Même identifiant que la ligne ${first}.`);
      else seenRefs.set(externalRef, line);
    }
    if (dupMessages.length > 0) {
      duplicatesInFile.push({ line, messages: dupMessages });
      return;
    }
    rows.push({ line, firstName, lastName, email: email ?? null, joinedOn, externalRef: externalRef ?? null });
  });

  return { fatal: null, totalRows: dataRows.length, rows, invalid, duplicatesInFile, ignoredColumns };
}

export interface ExistingKeys {
  emails: ReadonlySet<string>;
  externalRefs: ReadonlySet<string>;
  /** « prénom nom » en minuscules : sert uniquement à avertir d'un homonyme possible. */
  names: ReadonlySet<string>;
}

export interface ImportPlan {
  toCreate: ImportRow[];
  skippedExisting: RowIssue[];
  possibleHomonyms: RowIssue[];
}

export const nameKey = (firstName: string, lastName: string) => `${firstName} ${lastName}`.toLowerCase();

/** Compare les lignes valides aux membres déjà présents dans l'académie. */
export function planImport(rows: readonly ImportRow[], existing: ExistingKeys): ImportPlan {
  const toCreate: ImportRow[] = [];
  const skippedExisting: RowIssue[] = [];
  const possibleHomonyms: RowIssue[] = [];
  for (const row of rows) {
    if (row.email && existing.emails.has(row.email)) {
      skippedExisting.push({ line: row.line, messages: ["Un membre avec cet e-mail existe déjà."] });
    } else if (row.externalRef && existing.externalRefs.has(row.externalRef)) {
      skippedExisting.push({ line: row.line, messages: ["Un membre avec cet identifiant existe déjà."] });
    } else {
      toCreate.push(row);
      if (existing.names.has(nameKey(row.firstName, row.lastName))) {
        possibleHomonyms.push({ line: row.line, messages: ["Un membre portant le même nom existe déjà (homonyme possible)."] });
      }
    }
  }
  return { toCreate, skippedExisting, possibleHomonyms };
}
