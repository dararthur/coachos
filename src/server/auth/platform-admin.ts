import "server-only";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { isPlatformAdmin, registerPlatformAdmin } from "@/server/repositories/club-requests";
import type { SessionUser } from "./session";

/**
 * L'administrateur de la plateforme est le compte dont l'e-mail CONFIRMÉ est PLATFORM_ADMIN_EMAIL (environnement du serveur).
 * Cette adresse n'est jamais écrite en base, jamais renvoyée au navigateur ni journalisée : la base ne retient que l'identifiant du compte.
 * Chaque appel (re)désigne ce compte, ce qui retire un ancien administrateur si l'adresse de l'environnement change.
 */
export async function isPlatformAdminUser(user: SessionUser): Promise<boolean> {
  const configured = env().PLATFORM_ADMIN_EMAIL;
  if (!configured || !user.emailConfirmed || !user.email || user.email.toLowerCase() !== configured.toLowerCase()) return false;
  await registerPlatformAdmin(user.id);
  return withUser(user, (tx) => isPlatformAdmin(tx));
}

/** Comparaison pour l'inscription : l'adresse de l'administrateur peut créer son compte sans ticket. Jamais exposée par la réponse. */
export function isConfiguredAdminEmail(email: string): boolean {
  const configured = env().PLATFORM_ADMIN_EMAIL;
  return Boolean(configured) && email.trim().toLowerCase() === configured!.toLowerCase();
}
