/**
 * Lecture d'une erreur de Better Auth SANS `instanceof`.
 *
 * Pourquoi : Next.js peut charger deux copies du paquet (le bundle d'une Server Action et celui de la route /api/auth). Selon l'ordre des
 * premières requêtes après le démarrage, l'instance d'authentification est créée dans l'une ou l'autre : `error instanceof APIError` devient alors
 * faux et un mauvais mot de passe, une adresse non confirmée ou une limite de débit s'afficheraient comme « erreur inattendue ».
 * On reconnaît donc l'erreur à sa forme (nom, code HTTP numérique, corps).
 */
export function apiErrorInfo(error: unknown): { status: number; code: string | undefined } | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as { name?: unknown; statusCode?: unknown; body?: unknown };
  if (e.name !== "APIError" || typeof e.statusCode !== "number") return null;
  const code = typeof e.body === "object" && e.body !== null ? (e.body as { code?: unknown }).code : undefined;
  return { status: e.statusCode, code: typeof code === "string" ? code : undefined };
}
