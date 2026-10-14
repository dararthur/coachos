import "server-only";
import { cookies } from "next/headers";
import type { Role } from "@/domain/roles";

export const VIEW_COOKIE = "matnexa-view";

/**
 * Mode d'affichage de l'équipe (propriétaire, administrateur, coach) : « membre » montre l'espace d'un adhérent (planning à réserver,
 * classement, pointage). C'est un choix de PRÉSENTATION, mémorisé sur l'appareil : les droits restent ceux du rôle réel, vérifiés à chaque
 * requête côté serveur et par la base.
 */
export async function viewingAsMember(role: Role): Promise<boolean> {
  if (role === "member") return false;
  return (await cookies()).get(VIEW_COOKIE)?.value === "member";
}
