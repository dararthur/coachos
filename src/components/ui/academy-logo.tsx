/** Logo du club s'il en a un (servi aux membres du club) ; rien sinon, le nom du club suffit. */
export function AcademyLogo({ academy, size, className = "" }: { academy: { id: string; logoVersion: number | null }; size: number; className?: string }) {
  if (academy.logoVersion === null) return null;
  // eslint-disable-next-line @next/next/no-img-element -- image déjà normalisée (256 px max) et protégée par session : pas d'optimiseur.
  return <img src={`/a/${academy.id}/logo?v=${academy.logoVersion}`} alt="" width={size} height={size} className={`shrink-0 rounded-sm object-contain ${className}`} />;
}
