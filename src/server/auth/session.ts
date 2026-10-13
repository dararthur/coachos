import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  displayName: string;
}

/**
 * Utilisateur authentifié de la requête, validé côté serveur (lecture de la session en base, signature du cookie vérifiée) :
 * jamais déduit d'un cookie non vérifié. Mémorisé pour la durée de la requête.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    emailConfirmed: Boolean(session.user.emailVerified),
    displayName: session.user.name ?? "",
  };
});
