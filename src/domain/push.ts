import { z } from "zod";

/**
 * Services de notification des navigateurs. Le serveur envoie vers l'adresse fournie par le client : on n'accepte donc que ces
 * services (https, hôtes connus), jamais une adresse arbitraire (le serveur ne doit pas pouvoir être orienté vers un réseau interne).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Brave, Opera (Android et bureau)
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, // Safari, applications installées sur iPhone et iPad
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge historique
];

export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.port === "" && !url.username && !url.password && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

const base64url = /^[A-Za-z0-9_-]+={0,2}$/;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(20).max(1000).refine(isAllowedPushEndpoint, "Service de notification non pris en charge."),
  keys: z.object({
    p256dh: z.string().min(20).max(200).regex(base64url),
    auth: z.string().min(8).max(100).regex(base64url),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** Contenu d'une notification : court, sans donnée de membre. `url` est un chemin de l'application. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}
