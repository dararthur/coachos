/**
 * Falsification FIABLE d'un jeton pour les tests.
 *
 * Piège évité : le dernier caractère d'une signature HS256 en base64url (43 caractères) ne porte que 4 bits utiles ; en changer
 * la valeur entre A/B/C/D (ou k/l/m/n, etc.) laisse la signature décodée IDENTIQUE, donc le jeton « falsifié » reste valide
 * (≈ 6 % des cas : tests instables et rejet non prouvé). On modifie donc un caractère du MILIEU, dont les 6 bits comptent.
 */
export function forgeToken(token: string): string {
  const parts = token.split(".");
  const target = parts.length === 3 ? 2 : 0; // JWT : on altère la signature ; jeton opaque : le jeton lui-même
  const segment = parts[target]!;
  const i = Math.floor(segment.length / 2);
  const replacement = segment[i] === "A" ? "B" : "A";
  parts[target] = segment.slice(0, i) + replacement + segment.slice(i + 1);
  return parts.join(".");
}

/** Ancienne méthode, conservée UNIQUEMENT comme contrôle négatif du test unitaire (ne jamais l'utiliser dans un test de sécurité). */
export function forgeLastCharWeakly(token: string): string {
  return token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
}
