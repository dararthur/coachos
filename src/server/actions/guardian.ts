"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { emailField, uuidField } from "@/domain/validation";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { getSessionUser } from "@/server/auth/session";
import { withApp, withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { clientIp, enforceRateLimit, LIMITS } from "@/server/rate-limit";
import * as guardian from "@/server/repositories/guardian";
import { hashToken, parseForm } from "./helpers";
import { z } from "zod";

type FormState = ActionResult<unknown> | null;

/**
 * Le responsable légal confirme son accord depuis le lien reçu par e-mail (aucune connexion requise). Si un compte est connecté,
 * il est rattaché à la fiche de l'enfant (jamais écrasé). Ouvrir la page ne confirme rien : seul ce geste le fait.
 */
export async function confirmGuardianConsentAction(token: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("confirmGuardianConsent", async () => {
    const user = await getSessionUser();
    await enforceRateLimit("guardian-consent-confirm", user ? user.id : await clientIp(), 20, 15 * 60);
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return failure("not_found");
    const state = await withApp((tx) => guardian.confirmConsent(tx, hashToken(token), user?.id ?? null));
    if (state === "invalid") return failure("not_found", { _form: "Ce lien est invalide ou a expiré. Demandez un nouveau lien au club." });
    revalidatePath(`/consent/${token}`);
    return { ok: true, data: null, message: state === "already" ? "Votre accord était déjà enregistré." : "Merci : votre accord est enregistré." };
  });
}

export async function setChildRankingAction(childId: string, visible: boolean, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("setChildRanking", async () => {
    const user = await authorizeUser();
    const id = uuidField.safeParse(childId);
    if (!id.success) throw new AppError("not_found");
    await withUser(user, (tx) => guardian.setChildRanking(tx, id.data, visible));
    revalidatePath("/account");
    return { ok: true, data: null, message: visible ? "Votre enfant apparaît au classement." : "Votre enfant n'apparaît plus au classement." };
  });
}

/**
 * Le responsable autorise un compte propre pour son enfant (15 ans et plus) : retourne le lien d'invitation, affiché une seule fois.
 * Le compte ne fonctionne qu'avec l'adresse e-mail indiquée ; le lien expire dans 7 jours.
 */
export async function inviteMinorAccountAction(childId: string, _prev: FormState, formData: FormData): Promise<ActionResult<{ link: string; email: string }> | null> {
  return runAction("inviteMinorAccount", async () => {
    const user = await authorizeUser();
    await enforceRateLimit("invite", user.id, LIMITS.invitation.max, LIMITS.invitation.window);
    const id = uuidField.safeParse(childId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(z.object({ email: emailField }), formData);
    const token = randomBytes(32).toString("base64url");
    await withUser(user, (tx) => guardian.inviteMinorAccount(tx, id.data, input.email, hashToken(token)));
    return { ok: true, data: { link: `${env().SITE_URL}/invite/${token}`, email: input.email }, message: "Lien créé." };
  });
}

export async function withdrawChildConsentAction(childId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("withdrawChildConsent", async () => {
    const user = await authorizeUser();
    const id = uuidField.safeParse(childId);
    if (!id.success) throw new AppError("not_found");
    await withUser(user, (tx) => guardian.withdrawChildConsent(tx, id.data));
    revalidatePath("/account");
    return { ok: true, data: null, message: "Accord retiré : la fiche de votre enfant est archivée." };
  });
}
