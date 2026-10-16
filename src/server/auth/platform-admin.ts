import "server-only";
import { notFound, redirect } from "next/navigation";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { isPlatformAdmin, registerPlatformAdmin } from "@/server/repositories/club-requests";
import { hasAdminProof } from "./admin-proof";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Compte désigné comme administrateur de la plateforme (e-mail), SANS préjuger de la double authentification.
 * Sert à afficher le lien vers l'administration et à ouvrir la page de seconde authentification. Pour toute donnée ou action
 * d'administration, utiliser isPlatformAdminUser (qui exige en plus la preuve de seconde authentification).
 *
 * L'administrateur de la plateforme est le compte dont l'e-mail CONFIRMÉ est PLATFORM_ADMIN_EMAIL (environnement du serveur).
 * Cette adresse n'est jamais écrite en base, jamais renvoyée au navigateur ni journalisée : la base ne retient que l'identifiant du compte.
 * Chaque appel (re)désigne ce compte, ce qui retire un ancien administrateur si l'adresse de l'environnement change.
 */
export async function isPlatformAdminAccount(user: SessionUser): Promise<boolean> {
  const configured = env().PLATFORM_ADMIN_EMAIL;
  if (!configured || !user.emailConfirmed || !user.email || user.email.toLowerCase() !== configured.toLowerCase()) return false;
  await registerPlatformAdmin(user.id);
  return withUser(user, (tx) => isPlatformAdmin(tx));
}

/** Administrateur de la plateforme ET seconde authentification valide pour cette session : la seule condition d'accès à l'administration. */
export async function isPlatformAdminUser(user: SessionUser): Promise<boolean> {
  return (await isPlatformAdminAccount(user)) && (await hasAdminProof(user));
}

/**
 * Garde des pages d'administration : non connecté => connexion puis retour sur la page ; connecté mais pas administrateur => 404
 * (la page n'existe pas pour lui) ; administrateur sans seconde authentification valide => page de vérification. Les actions serveur refont leur propre contrôle : ce garde ne protège que l'affichage.
 */
export async function requirePlatformAdmin(path: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (!(await isPlatformAdminAccount(user))) notFound();
  if (!(await hasAdminProof(user))) redirect(`/admin/security?next=${encodeURIComponent(path)}`);
  return user;
}

/** Comparaison pour l'inscription : l'adresse de l'administrateur peut créer son compte sans ticket. Jamais exposée par la réponse. */
export function isConfiguredAdminEmail(email: string): boolean {
  const configured = env().PLATFORM_ADMIN_EMAIL;
  return Boolean(configured) && email.trim().toLowerCase() === configured!.toLowerCase();
}
