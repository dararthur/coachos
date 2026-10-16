import "server-only";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { isFeature, type Feature } from "@/domain/features";
import { can, isRole, type Permission, type Role } from "@/domain/roles";
import { withUser, type Tx } from "@/server/db/client";
import { mySuspendedClubs } from "@/server/repositories/suspension";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { getSessionUser, type SessionUser } from "./session";

const uuid = z.uuid();

/** Pages : exige une session valide, sinon redirige vers la connexion. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export interface AcademyContext {
  user: SessionUser;
  role: Role;
  academy: { id: string; name: string; timezone: string; currency: string; retentionMonths: number; adultClassMinAge: number; logoVersion: number | null };
  /** Modules coupés pour ce club par l'administrateur de la plateforme (tout est activé par défaut). */
  disabledFeatures: readonly Feature[];
}

const loadContext = cache(async (userId: string, academyId: string) => {
  return withUser({ id: userId }, async (tx) => {
    const rows = await tx<{ role: string; id: string; name: string; timezone: string; currency: string; retention_months: number; adult_class_min_age: number; logo_version: Date | null; disabled_features: string[] }[]>`
      select m.role, a.id, a.name, a.timezone, a.currency, a.retention_months, a.adult_class_min_age,
             (select l.updated_at from public.academy_logos l where l.academy_id = a.id) as logo_version,
             coalesce((select array_agg(f.feature) from public.club_features f where f.academy_id = a.id and not f.enabled), '{}') as disabled_features
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.academy_id = ${academyId} and m.user_id = ${userId}`;
    return rows[0] ?? null;
  });
});

/**
 * Résout l'appartenance de l'utilisateur à l'académie demandée (lue sous RLS).
 * Non-membre ou identifiant invalide => null (indiscernable d'une académie inexistante).
 */
export async function resolveAcademy(user: SessionUser, academyId: string): Promise<AcademyContext | null> {
  if (!uuid.safeParse(academyId).success) return null;
  const row = await loadContext(user.id, academyId);
  if (!row || !isRole(row.role)) return null;
  return {
    user,
    role: row.role,
    academy: { id: row.id, name: row.name, timezone: row.timezone, currency: row.currency, retentionMonths: row.retention_months, adultClassMinAge: row.adult_class_min_age, logoVersion: row.logo_version?.getTime() ?? null },
    disabledFeatures: row.disabled_features.filter(isFeature),
  };
}

/** Le club est-il suspendu, et le compte y est-il membre ? (La base ferme alors tout accès : le club n'apparaît plus qu'ici.) */
async function isSuspendedFor(user: SessionUser, academyId: string): Promise<boolean> {
  if (!uuid.safeParse(academyId).success) return false;
  return (await withUser({ id: user.id }, (tx) => mySuspendedClubs(tx))).some((c) => c.id === academyId);
}

/**
 * Pages : académie accessible et permission requise. Non-membre => 404 ; membre sans droit => page « accès refusé » ;
 * module coupé pour le club (`feature`) => page « non incluse dans votre formule ».
 */
export async function requireAcademy(academyId: string, permission?: Permission, feature?: Feature): Promise<AcademyContext> {
  const user = await requireUser();
  const ctx = await resolveAcademy(user, academyId);
  if (!ctx) {
    if (await isSuspendedFor(user, academyId)) redirect("/suspended");
    notFound();
  }
  if (permission && !can(ctx.role, permission)) redirect(`/a/${ctx.academy.id}/forbidden`);
  if (feature && ctx.disabledFeatures.includes(feature)) redirect(`/a/${ctx.academy.id}/unavailable?feature=${feature}`);
  return ctx;
}

/** Server Actions : lève AppError au lieu de rediriger. */
export async function authorizeAcademy(academyId: string, permission?: Permission, feature?: Feature): Promise<AcademyContext> {
  const user = await getSessionUser();
  if (!user) throw new AppError("not_authenticated");
  await enforceRateLimit("write", user.id, LIMITS.writes.max, LIMITS.writes.window);
  const ctx = await resolveAcademy(user, academyId);
  if (!ctx) throw new AppError((await isSuspendedFor(user, academyId)) ? "club_suspended" : "not_found");
  if (permission && !can(ctx.role, permission)) throw new AppError("forbidden");
  if (feature && ctx.disabledFeatures.includes(feature)) throw new AppError("feature_disabled");
  return ctx;
}

export async function authorizeUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("not_authenticated");
  return user;
}

/** Exécute dans une transaction RLS au nom du contexte. */
export function inAcademy<T>(ctx: { user: SessionUser }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUser({ id: ctx.user.id, email: ctx.user.email }, fn);
}

/**
 * Enveloppe commune des Server Actions : convertit toute erreur en résultat typé et sûr,
 * journalise sans donnée personnelle, laisse passer les redirections de Next.js.
 */
export async function runAction<T>(name: string, fn: () => Promise<ActionResult<T> | ActionResult<never>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError) {
      if (error.code === "internal") logger.error(`action.${name}`, error);
      return failure(error.code, error.fieldErrors);
    }
    logger.error(`action.${name}`, error);
    return failure("internal");
  }
}
