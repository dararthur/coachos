// Politique SSL des connexions PostgreSQL — miroir EXACT de src/server/db-url.ts (le test tests/unit/db-url.test.ts les compare).
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];

/** Une base est « locale » si l'hôte est une boucle locale ou un socket Unix (hôte vide ou chemin). */
export function isLocalDatabaseUrl(urlString) {
  const url = new URL(urlString);
  const host = url.hostname;
  const socketHost = url.searchParams.get("host");
  return host === "" || LOOPBACK.includes(host.toLowerCase()) || (socketHost?.startsWith("/") ?? false);
}

/**
 * Violation de la politique SSL, ou null. Une base DISTANTE exige `sslmode=require|verify-ca|verify-full` dans l'URL.
 * `DATABASE_SSL=disable` est interdit pour une base distante.
 */
export function sslViolation(urlString, { databaseSslDisabled = false } = {}) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null; // URL invalide : signalée ailleurs
  }
  if (isLocalDatabaseUrl(urlString)) return null;
  if (databaseSslDisabled) return "DATABASE_SSL=disable est interdit pour une base distante";
  const mode = url.searchParams.get("sslmode") ?? "";
  if (!["require", "verify-ca", "verify-full"].includes(mode)) return "une base distante exige sslmode=require (ou verify-ca / verify-full) dans l'URL";
  return null;
}
