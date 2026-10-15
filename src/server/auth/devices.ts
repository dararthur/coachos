import { describeUserAgent, type DeviceKind } from "@/domain/user-agent";
import type { CoachAuth } from "./factory";

/**
 * « Mes appareils connectés » : les sessions actives de l'utilisateur de la requête, et leur révocation. Configuration pure
 * (sans Next.js) pour être testée contre la vraie base (tests/db/auth-integration.test.ts).
 *
 * Les points d'entrée HTTP de Better Auth (/list-sessions, /revoke-session…) sont fermés (DISABLED_PATHS) : seules les Server
 * Actions de src/server/actions/auth.ts appellent ces fonctions, en processus.
 *
 * Lecture : par l'adaptateur interne de Better Auth et non `auth.api.listSessions`, qui exige une session ouverte depuis moins
 * de 24 h (« fraîche ») : avec des sessions d'un an, la liste serait refusée sur presque tous les téléphones.
 * Révocation : `auth.api.revokeSession` / `revokeOtherSessions` (session vérifiée en base, aucune exigence de fraîcheur).
 *
 * Ni le jeton ni l'IP (pseudonyme HMAC) ne sortent d'ici : seul un libellé grossier tiré du User-Agent est exposé.
 */

export interface ConnectedDevice {
  /** Identifiant de la session (pas son jeton) : seule référence envoyée au navigateur. */
  id: string;
  kind: DeviceKind;
  label: string;
  current: boolean;
  /** Mise à jour au plus une fois par jour (updateAge de la session) : précision au jour. */
  lastActiveAt: Date;
  signedInAt: Date;
}

export type RevokeOutcome = "revoked" | "not_found" | "current";

interface SessionRow {
  id: string;
  token: string;
  userId: string;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

async function currentSession(auth: CoachAuth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session ? { id: session.session.id, userId: session.user.id } : null;
}

async function activeSessions(auth: CoachAuth, userId: string): Promise<SessionRow[]> {
  const ctx = await auth.$context;
  const rows = (await ctx.internalAdapter.listSessions(userId, { onlyActiveSessions: true })) as SessionRow[];
  const now = Date.now();
  // Double garde : l'adaptateur filtre déjà par utilisateur et par expiration.
  return rows.filter((s) => s.userId === userId && new Date(s.expiresAt).getTime() > now);
}

/** null si la requête n'a pas de session valide. Appareil courant en tête, puis du plus récemment actif au plus ancien. */
export async function listConnectedDevices(auth: CoachAuth, headers: Headers): Promise<ConnectedDevice[] | null> {
  const me = await currentSession(auth, headers);
  if (!me) return null;
  return (await activeSessions(auth, me.userId))
    .map((s) => ({
      id: s.id,
      ...describeUserAgent(s.userAgent),
      current: s.id === me.id,
      lastActiveAt: new Date(s.updatedAt),
      signedInAt: new Date(s.createdAt),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
}

/**
 * Déconnecte un autre appareil de l'utilisateur. La session visée n'est cherchée QUE parmi celles de l'utilisateur de la
 * requête : l'identifiant d'une session d'un autre compte (ou inconnu) donne « not_found », sans rien révoquer ni révéler.
 * L'appareil courant se déconnecte par « Se déconnecter » (le cookie est alors effacé), pas ici.
 */
export async function revokeConnectedDevice(auth: CoachAuth, headers: Headers, sessionId: string): Promise<RevokeOutcome | null> {
  const me = await currentSession(auth, headers);
  if (!me) return null;
  if (sessionId === me.id) return "current";
  const target = (await activeSessions(auth, me.userId)).find((s) => s.id === sessionId);
  if (!target) return "not_found";
  // Better Auth revérifie que la session appartient à l'utilisateur de la requête avant de la supprimer.
  await auth.api.revokeSession({ body: { token: target.token }, headers });
  return "revoked";
}

/** Déconnecte tous les appareils de l'utilisateur sauf celui de la requête. */
export async function revokeOtherConnectedDevices(auth: CoachAuth, headers: Headers): Promise<boolean> {
  if (!(await currentSession(auth, headers))) return false;
  await auth.api.revokeOtherSessions({ headers });
  return true;
}
