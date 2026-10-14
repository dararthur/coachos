const SIZES = { sm: "size-9 text-xs", md: "size-12 text-sm", lg: "size-24 text-2xl" } as const;

export function initialsOf(firstName: string, lastName: string): string {
  const f = firstName.trim().charAt(0);
  const l = lastName.trim() === "·" ? "" : lastName.trim().charAt(0);
  return (f + l).toUpperCase() || "?";
}

/** Photo du membre si elle existe (servie sous contrôle d'accès), sinon ses initiales. */
export function Avatar({
  academyId,
  personId,
  firstName,
  lastName,
  hasPhoto,
  size = "md",
  version,
}: {
  academyId: string;
  personId: string;
  firstName: string;
  lastName: string;
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
  return (
    <span aria-hidden="true" className={`${cls} inline-flex items-center justify-center bg-sunken font-bold text-ink-soft`}>
      {initialsOf(firstName, lastName)}
    </span>
  );
}
