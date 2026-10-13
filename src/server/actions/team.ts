"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { isRole } from "@/domain/roles";
import { invitationSchema, uuidField } from "@/domain/validation";
import { authorizeAcademy, authorizeUser, inAcademy, runAction } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import * as team from "@/server/repositories/team";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { hashToken, parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

/** Retourne le lien d'invitation, affiché une seule fois (seul son hachage est conservé). */
export async function inviteAction(academyId: string, _prev: FormState, formData: FormData): Promise<ActionResult<{ link: string; email: string }> | null> {
  return runAction("invite", async () => {
    const ctx = await authorizeAcademy(academyId, "team.manage");
    await enforceRateLimit("invite", ctx.user.id, LIMITS.invitation.max, LIMITS.invitation.window);
    const input = parseForm(invitationSchema, formData);
    const token = randomBytes(32).toString("base64url");
    await inAcademy(ctx, (tx) =>
      team.createInvitation(tx, { academyId, email: input.email, role: input.role, personId: input.personId ?? null, tokenHash: hashToken(token) }),
    );
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: { link: `${env().SITE_URL}/invite/${token}`, email: input.email }, message: "Invitation créée." };
  });
}

const idSchema = z.object({ id: uuidField });

export async function revokeInvitationAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("revokeInvitation", async () => {
    const ctx = await authorizeAcademy(academyId, "team.manage");
    const { id } = parseForm(idSchema, formData);
    await inAcademy(ctx, (tx) => team.revokeInvitation(tx, academyId, id));
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: "Invitation révoquée." };
  });
}

const roleSchema = z.object({ userId: uuidField, role: z.string().refine(isRole, "Rôle invalide.") });

export async function changeRoleAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("changeRole", async () => {
    const ctx = await authorizeAcademy(academyId, "team.manage");
    const input = parseForm(roleSchema, formData);
    if (!isRole(input.role)) throw new AppError("invalid_role");
    const role = input.role;
    await inAcademy(ctx, (tx) => team.setMemberRole(tx, academyId, input.userId, role));
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: "Rôle mis à jour." };
  });
}

export async function removeMemberAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("removeMember", async () => {
    const ctx = await authorizeAcademy(academyId);
    const { userId } = parseForm(z.object({ userId: uuidField }), formData);
    await inAcademy(ctx, (tx) => team.removeMember(tx, academyId, userId));
    revalidatePath(`/a/${academyId}/settings`);
    if (userId === ctx.user.id) redirect("/academies");
    return { ok: true, data: null, message: "Membre retiré de l'équipe." };
  });
}

/** Acceptation explicite (POST) d'une invitation par l'utilisateur connecté. */
export async function acceptInvitationAction(token: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("acceptInvitation", async () => {
    const user = await authorizeUser();
    await enforceRateLimit("invite-accept", user.id, LIMITS.invitationAccept.max, LIMITS.invitationAccept.window);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return failure("invitation_invalid");
    const academyId = await withUser(user, (tx) => team.acceptInvitation(tx, hashToken(token)));
    redirect(`/a/${academyId}/dashboard`);
  });
}
