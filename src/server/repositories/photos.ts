import "server-only";
import type { Tx } from "@/server/db/client";

export async function setMyPhoto(tx: Tx, academyId: string, contentType: string, data: Buffer): Promise<void> {
  await tx`select public.set_my_photo(${academyId}, ${contentType}, ${data})`;
}

export async function removePhoto(tx: Tx, academyId: string, personId: string): Promise<void> {
  await tx`select public.remove_person_photo(${academyId}, ${personId})`;
}

export interface StoredPhoto {
  contentType: string;
  data: Buffer;
  updatedAt: Date;
}

/** Photo d'une fiche ; la RLS décide de la visibilité (soi-même, staff, ou membre du classement). */
export async function getPhoto(tx: Tx, academyId: string, personId: string): Promise<StoredPhoto | null> {
  const [row] = await tx<{ contentType: string; data: Buffer; updatedAt: Date }[]>`
    select content_type as "contentType", data, updated_at as "updatedAt"
    from public.person_photos where person_id = ${personId} and academy_id = ${academyId}`;
  return row ?? null;
}

/** Fiches de l'académie qui ont une photo visible par l'appelant, avec la date de mise à jour (pour invalider le cache navigateur). */
export async function photoVersions(tx: Tx, academyId: string): Promise<Map<string, number>> {
  const rows = await tx<{ personId: string; v: Date }[]>`select person_id as "personId", updated_at as v from public.person_photos where academy_id = ${academyId}`;
  return new Map(rows.map((r) => [r.personId, r.v.getTime()]));
}
