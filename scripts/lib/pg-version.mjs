// Politique de version PostgreSQL — UNE seule source, partagée par le lanceur de migrations, le préflight et la CI.
//
//   cible      17  : version contre laquelle TOUT est testé (tests de base de données : 17.10 embarqué ; CI : postgres:17).
//   minimale   15  : en dessous, la syntaxe ou les droits de rôle utilisés ne sont pas garantis → refus.
//   non testées : 15, 16 et ≥ 18 → autorisées mais signalées (avertissement) ; à tester en CI avant tout déploiement.
export const PG_TARGET_MAJOR = 17;
export const PG_MIN_MAJOR = 15;
export const PG_TESTED_MAJORS = [17];

/** @param {number | string} serverVersionNum valeur de `server_version_num` (ex. 170010). */
export function assessPostgresVersion(serverVersionNum) {
  const num = Number(serverVersionNum);
  const major = Math.floor(num / 10000);
  if (!Number.isFinite(num) || major < 1) return { level: "unsupported", major: 0, message: "version de PostgreSQL illisible" };
  if (major < PG_MIN_MAJOR) return { level: "unsupported", major, message: `PostgreSQL ${major} n'est pas supporté (minimum ${PG_MIN_MAJOR}, cible ${PG_TARGET_MAJOR})` };
  if (!PG_TESTED_MAJORS.includes(major)) return { level: "untested", major, message: `PostgreSQL ${major} n'est pas testé (cible ${PG_TARGET_MAJOR}) : le rejouer en CI avant tout déploiement` };
  return { level: "ok", major, message: `PostgreSQL ${major} (version cible testée)` };
}
