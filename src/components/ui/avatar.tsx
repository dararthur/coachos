import type { AvatarStyle } from "@/domain/profile";
import { Silhouette } from "./silhouette";

const SIZES = { sm: "size-9", md: "size-12", lg: "size-24" } as const;

/** Photo du membre si elle existe (servie sous contrôle d'accès), sinon la silhouette choisie dans son profil. */
export function Avatar({
  academyId,
  personId,
  avatarStyle,
  hasPhoto,
  size = "md",
  version,
}: {
  academyId: string;
  personId: string;
  avatarStyle: AvatarStyle;
  hasPhoto: boolean;
  size?: keyof typeof SIZES;
  /** Change à chaque nouvelle photo pour contourner le cache du navigateur. */
  version?: number;
}) {
  const cls = `${SIZES[size]} shrink-0 rounded-sm`;
  if (hasPhoto) {
    // eslint-disable-next-line @next/next/no-img-element -- image déjà normalisée à 256 px et protégée par session : pas d'optimiseur.
    return <img src={`/a/${academyId}/photo/${personId}${version ? `?v=${version}` : ""}`} alt="" width={256} height={256} loading="lazy" className={`${cls} bg-sunken object-cover`} />;
  }
  return <Silhouette style={avatarStyle} className={cls} />;
}
