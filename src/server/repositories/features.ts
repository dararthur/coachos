import "server-only";
import { isFeature, type Feature } from "@/domain/features";
import type { Tx } from "@/server/db/client";

/** Le module est-il activé pour ce club ? (lu sous RLS : seuls les membres du club obtiennent une réponse autre que « activé ».) */
export async function featureEnabled(tx: Tx, academyId: string, feature: Feature): Promise<boolean> {
  const [row] = await tx<{ on: boolean }[]>`select app_private.feature_enabled(${academyId}, ${feature}) as "on"`;
  return row?.on !== false;
}

export interface ClubFeatureState {
  feature: Feature;
  enabled: boolean;
}

/** Réglage d'un club, pour la console de l'administrateur (la fonction refuse tout autre compte). */
export async function clubFeatures(tx: Tx, academyId: string): Promise<ClubFeatureState[]> {
  const rows = await tx<{ feature: string; enabled: boolean }[]>`select feature, enabled from public.admin_club_features(${academyId})`;
  return rows.filter((r): r is ClubFeatureState => isFeature(r.feature));
}

export async function setClubFeature(tx: Tx, academyId: string, feature: Feature, enabled: boolean): Promise<void> {
  await tx`select public.admin_set_club_feature(${academyId}, ${feature}, ${enabled})`;
}
