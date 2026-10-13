import "server-only";
import type { Tx } from "@/server/db/client";
import type { Role } from "@/domain/roles";

export interface TeamMember {
  userId: string;
  role: Role;
  displayName: string;
  email: string | null;
  joinedAt: Date;
}

export async function listTeam(tx: Tx, academyId: string): Promise<TeamMember[]> {
  return tx<TeamMember[]>`
    select m.user_id as "userId", m.role, coalesce(p.display_name, '') as "displayName", p.email, m.created_at as "joinedAt"
    from public.academy_memberships m left join public.profiles p on p.id = m.user_id
    where m.academy_id = ${academyId}
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'coach' then 2 else 3 end, lower(coalesce(p.display_name, p.email, ''))`;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: Date;
  personId: string | null;
}

export async function listInvitations(tx: Tx, academyId: string): Promise<PendingInvitation[]> {
  return tx<PendingInvitation[]>`
    select id, email, role, expires_at as "expiresAt", person_id as "personId"
    from public.invitations
    where academy_id = ${academyId} and accepted_at is null and expires_at > now()
    order by created_at desc`;
}

export async function createInvitation(
  tx: Tx,
  input: { academyId: string; email: string; role: string; personId: string | null; tokenHash: string },
): Promise<void> {
  await tx`select public.create_invitation(${input.academyId}, ${input.email}, ${input.role}, ${input.personId}, ${input.tokenHash})`;
}

export async function revokeInvitation(tx: Tx, academyId: string, id: string): Promise<boolean> {
  const r = await tx`delete from public.invitations where id = ${id} and academy_id = ${academyId} and accepted_at is null`;
  return r.count === 1;
}

export async function acceptInvitation(tx: Tx, tokenHash: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`select public.accept_invitation(${tokenHash}) as id`;
  return row!.id;
}

export async function setMemberRole(tx: Tx, academyId: string, userId: string, role: Role): Promise<void> {
  await tx`select public.set_member_role(${academyId}, ${userId}, ${role})`;
}

export async function removeMember(tx: Tx, academyId: string, userId: string): Promise<void> {
  await tx`select public.remove_member(${academyId}, ${userId})`;
}

export interface AuditEntry {
  id: number;
  action: string;
  createdAt: Date;
  actorName: string | null;
}

export async function listAudit(tx: Tx, academyId: string, limit = 50): Promise<AuditEntry[]> {
  return tx<AuditEntry[]>`
    select e.id::int as id, e.action, e.created_at as "createdAt", coalesce(nullif(p.display_name, ''), p.email) as "actorName"
    from public.audit_events e left join public.profiles p on p.id = e.actor_user_id
    where e.academy_id = ${academyId}
    order by e.id desc limit ${limit}`;
}
