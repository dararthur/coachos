/** Code de club : 8 caractères, A-Z (sans I ni O) et 2-9. Saisie tolérante (casse, espaces, tirets). */
const CODE_PATTERN = /^[A-Z2-9]{8}$/;

export function normalizeJoinCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** Affichage par groupes de quatre : ABCD-EFGH. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
