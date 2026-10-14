import "server-only";
import type { Tx } from "@/server/db/client";

/** Nom du club correspondant à un code, null si le code est inconnu. */
export async function previewJoinCode(tx: Tx, code: string): Promise<string | null> {
  const [row] = await tx<{ name: string | null }[]>`select public.preview_join_code(${code}) as name`;
  return row?.name ?? null;
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
