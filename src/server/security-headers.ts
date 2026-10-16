/**
 * HSTS : UN SEUL émetteur — l'application (src/proxy.ts), jamais Nginx (voir ops/nginx/coachos.conf, testé).
 * Politique volontairement prudente : AUCUN `includeSubDomains` et AUCUN `preload` (le domaine peut héberger d'autres applications
 * et la précharge est quasi irréversible). Émis seulement pour une instance déployée (staging, production) servie en https.
 *
 * Montée en charge recommandée (docs/nginx.md) : 300 s → 86 400 s → 31 536 000 s, via HSTS_MAX_AGE_SECONDS, une fois HTTPS validé.
 * Par défaut : staging 300 s, production 86 400 s (un jour).
 */
export const HSTS_MAX_ALLOWED = 31_536_000;

export interface HstsInput {
  appEnv?: string | undefined;
  siteUrl?: string | undefined;
  maxAge?: string | undefined;
}

/**
 * Directive CSP `upgrade-insecure-requests` : seulement pour une instance servie en https (où elle réécrit d'éventuels liens http).
 * Pour une SITE_URL en http (pile de test locale), WebKit (Safari) l'applique même à 127.0.0.1 : scripts et styles partaient vers
 * https://127.0.0.1 et échouaient, la page n'était jamais interactive. Chrome et Firefox exemptent l'adresse locale.
 */
export function upgradeInsecureRequests(siteUrl: string | undefined): boolean {
  return !!siteUrl?.startsWith("https://");
}

export function hstsHeader({ appEnv, siteUrl, maxAge }: HstsInput): string | null {
  if (appEnv !== "staging" && appEnv !== "production") return null;
  if (!siteUrl?.startsWith("https://")) return null;
  const fallback = appEnv === "production" ? 86_400 : 300;
  const parsed = maxAge && /^\d+$/.test(maxAge) ? Number(maxAge) : fallback;
  const seconds = Math.min(Math.max(parsed, 0), HSTS_MAX_ALLOWED);
  return seconds === 0 ? null : `max-age=${seconds}`;
}
