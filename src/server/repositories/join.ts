import "server-only";
import type { Tx } from "@/server/db/client";

/** Nom du club correspondant à un code, null si le code est inconnu. */
export async function previewJoinCode(tx: Tx, code: string): Promise<string | null> {
  const [row] = await tx<{ name: string | null }[]>`select public.preview_join_code(${code}) as name`;
  return row?.name ?? null;
}

/**
 * Lien de partage, avant toute connexion (rôle app_server, appelant limité en débit) : nom du club, et son identifiant
 * pour reconnaître un compte déjà membre. L'identifiant n'est jamais affiché.
 */
export async function previewJoinCodePublic(tx: Tx, code: string): Promise<{ academyId: string; name: string } | null> {
  const [row] = await tx<{ academyId: string; name: string }[]>`select academy_id as "academyId", name from app_private.preview_join_code_public(${code})`;
  return row ?? null;
}

/** L'utilisateur connecté appartient-il déjà à ce club ? (RLS : il ne lit que ses propres appartenances) */
export async function isMemberOf(tx: Tx, academyId: string): Promise<boolean> {
  const rows = await tx`select 1 from public.academy_memberships where academy_id = ${academyId} and user_id = (select auth.uid())`;
  return rows.length > 0;
}

export async function joinAcademyWithCode(tx: Tx, code: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`select public.join_academy_with_code(${code}) as id`;
  return row!.id;
}

/** Code du club, visible de l'équipe d'encadrement uniquement (RLS). */
export async function getJoinCode(tx: Tx, academyId: string): Promise<string | null> {
  const [row] = await tx<{ code: string }[]>`select code from public.academy_join_codes where academy_id = ${academyId}`;
  return row?.code ?? null;
}

export async function regenerateJoinCode(tx: Tx, academyId: string): Promise<string> {
  const [row] = await tx<{ code: string }[]>`select public.regenerate_join_code(${academyId}) as code`;
  return row!.code;
}
