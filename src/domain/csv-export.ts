/**
 * Sérialisation CSV sûre (RFC 4180) pour les exports.
 *  - guillemets et séparateurs échappés ;
 *  - neutralisation de l'injection de formules (Excel / LibreOffice / Sheets) : toute cellule texte
 *    commençant par = + - @ tabulation ou retour chariot est préfixée d'une apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown, delimiter = ";"): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  // Les cellules texte sont toujours entre guillemets : plus simple à prouver correct.
  void delimiter;
  return `"${text.replace(/"/g, '""')}"`;
}

export interface CsvOptions {
  delimiter?: ";" | ",";
  /** BOM UTF-8 : indispensable pour qu'Excel lise correctement les accents. */
  bom?: boolean;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ";";
  const lines = [headers.map((h) => csvCell(h, delimiter)).join(delimiter)];
  for (const row of rows) lines.push(row.map((cell) => csvCell(cell, delimiter)).join(delimiter));
  return (options.bom === false ? "" : "﻿") + lines.join("\r\n") + "\r\n";
}

/** Nom de fichier d'export sûr pour l'en-tête Content-Disposition. */
export function safeFilename(base: string, extension: string): string {
  const cleaned = base
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${cleaned || "export"}.${extension.replace(/[^a-z0-9]/gi, "")}`;
}
