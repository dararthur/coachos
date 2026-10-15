export const ROLES = ["owner", "admin", "coach", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  coach: "Coach",
  member: "Membre",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Matrice des permissions. Source de vérité côté application (UI + garde serveur).
 * La base de données applique les mêmes règles via la RLS et les fonctions SECURITY DEFINER ;
 * tests/db/permissions-matrix.test.ts vérifie que les deux restent alignées.
 * Restriction supplémentaire côté base : un coach n'enregistre les présences que de ses séances
 * (ou des séances sans coach).
 */
export const PERMISSIONS = {
  "dashboard.read": ["owner", "admin", "coach"],
  "academy.update": ["owner", "admin"],
  "academy.delete": ["owner"],
  "team.manage": ["owner", "admin"],
  "catalog.manage": ["owner", "admin"],
  "members.read": ["owner", "admin", "coach"],
  "members.create": ["owner", "admin", "coach"],
  "members.update": ["owner", "admin"],
  "members.import": ["owner", "admin"],
  "members.erase": ["owner", "admin"],
  "schedule.read": ["owner", "admin", "coach", "member"],
  "schedule.manage": ["owner", "admin"],
  "attendance.record": ["owner", "admin", "coach"],
  "reports.read": ["owner", "admin", "coach"],
  "reports.export": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
  // Publier une actualité (la lire : tout membre du club ; un coach ne modifie que les siennes, un administrateur toutes).
  "news.manage": ["owner", "admin", "coach"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Rôles qu'un acteur peut attribuer (reflète public.set_member_role / create_invitation). */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["owner", "admin", "coach", "member"];
  if (actor === "admin") return ["coach", "member"];
  return [];
}

export function canManageMember(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "coach" || target === "member";
  return false;
}
