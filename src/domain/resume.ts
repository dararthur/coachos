/**
 * Parcours qu'une création de compte ou une connexion doit reprendre ensuite (paramètre `next`), quel que soit l'aller-retour
 * connexion ↔ inscription ↔ e-mail de confirmation : rejoindre un club, accepter une invitation, suivre son enfant après l'accord
 * du responsable légal, ou confirmer un pointage.
 */
export type ResumeKind = "join" | "invite" | "consent" | "checkin";

const PREFIXES: [string, ResumeKind][] = [
  ["/join/", "join"],
  ["/invite/", "invite"],
  ["/consent/", "consent"],
  ["/checkin/", "checkin"],
];

/** Nature du parcours à reprendre, ou `null` si `next` n'en est pas un (ex. une page interne quelconque). */
export function resumeKind(next: string): ResumeKind | null {
  return PREFIXES.find(([p]) => next.startsWith(p))?.[1] ?? null;
}

/** Ajoute `next` à un chemin (`/signup`, `/login`) seulement s'il désigne un parcours à reprendre. */
export function withResume(path: string, next: string): string {
  return resumeKind(next) ? `${path}?next=${encodeURIComponent(next)}` : path;
}
