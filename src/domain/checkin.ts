/**
 * Pointage par QR code : constantes et analyse du contenu scanné (pur, sans I/O).
 *
 * Le QR ne contient QUE l'adresse `<site>/checkin/<jeton>` où le jeton est un secret aléatoire opaque de 256 bits,
 * éphémère et révocable. Il ne contient ni identifiant de membre, ni de séance, ni donnée personnelle ; et il n'est
 * jamais une preuve d'identité : l'adhérent s'authentifie séparément (session) et le serveur décide.
 */

/** Durée de vie d'un jeton (le serveur borne entre 10 s et 300 s). */
export const CHECKIN_TOKEN_TTL_SECONDS = 90;
/** Le QR affiché est renouvelé bien avant l'expiration du précédent (recouvrement = tolérance de scan). */
export const CHECKIN_REFRESH_SECONDS = 45;
/** Actualisation de la feuille d'appel du coach. */
export const ROLL_POLL_INTERVAL_MS = 4_000;

/** 32 octets en base64url sans remplissage. */
export const CHECKIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isCheckinToken(value: unknown): value is string {
  return typeof value === "string" && CHECKIN_TOKEN_PATTERN.test(value);
}

/** Scanner ouvert depuis « Pointer ma présence » : la caméra démarre sans second appui (le geste explicite vient d'avoir lieu). */
export const SCAN_PATH = "/checkin?scan=1";

export function checkinPath(token: string): string {
  return `/checkin/${token}`;
}

/**
 * Extrait un jeton d'un contenu scanné ou saisi : jeton nu, ou lien `<origine>/checkin/<jeton>` de CE site uniquement.
 * Toute autre URL (autre domaine, autre chemin, schéma exotique) est refusée : on ne navigue jamais vers une destination
 * choisie par le contenu d'un QR.
 * @param allowedOrigin origine du site (ex. `https://app.exemple.fr`)
 */
export function extractCheckinToken(input: string, allowedOrigin: string): string | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 600) return null;
  if (isCheckinToken(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== new URL(allowedOrigin).origin) return null;
  const match = /^\/checkin\/([A-Za-z0-9_-]{43})\/?$/.exec(url.pathname);
  return match ? match[1]! : null;
}

/** Secondes restantes (arrondi au supérieur, jamais négatif). */
export function remainingSeconds(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

// --- QR fixe du club ---------------------------------------------------------------------------------
/** Clé du QR fixe : 96 bits en hexadécimal. */
export const CLUB_KEY_PATTERN = /^[a-f0-9]{24}$/;

export function isClubKey(value: unknown): value is string {
  return typeof value === "string" && CLUB_KEY_PATTERN.test(value);
}

export function clubCheckinPath(key: string): string {
  return `/checkin/club/${key}`;
}

/** Même prudence que pour un jeton : seul un lien `<origine>/checkin/club/<clé>` de CE site est suivi. */
export function extractClubKey(input: string, allowedOrigin: string): string | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 600) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== new URL(allowedOrigin).origin) return null;
  const match = /^\/checkin\/club\/([a-f0-9]{24})\/?$/.exec(url.pathname);
  return match ? match[1]! : null;
}

/** Réglages de fenêtre (minutes) proposés au club. */
export const CHECKIN_WINDOW_DEFAULTS = { before: 45, after: 30 } as const;
export const CHECKIN_WINDOW_MAX_MINUTES = 240;
