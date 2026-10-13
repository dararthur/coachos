"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { changePasswordSchema, loginSchema, profileSchema, resetPasswordSchema, resetRequestSchema, signupSchema } from "@/domain/validation";
import { getAuth } from "@/server/auth/auth";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { parseForm, safeNext } from "./helpers";

type FormState = ActionResult<unknown> | null;

/** Les limites de débit (inscription, connexion, réinitialisation) sont appliquées dans Better Auth (hook), pour tout chemin. */
function apiStatus(error: unknown): { status: number; code: string | undefined } | null {
  if (!(error instanceof APIError)) return null;
  const body = error.body as { code?: unknown } | undefined;
  return { status: error.statusCode, code: typeof body?.code === "string" ? body.code : undefined };
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("signUp", async () => {
    const input = parseForm(signupSchema, formData);
    try {
      await getAuth().api.signUpEmail({
        body: { name: input.displayName ?? "", email: input.email, password: input.password, callbackURL: "/login?verified=1" },
        headers: await headers(),
      });
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      logger.warn("auth.signup_failed", { status: api.status, code: api.code });
      if (api.status === 429) return failure("rate_limited");
      if (api.code === "PASSWORD_TOO_SHORT" || api.code === "PASSWORD_TOO_LONG") return failure("validation", { password: "Mot de passe trop court ou trop long." });
      return failure("internal");
    }
    // Avec confirmation par e-mail, aucune session n'existe encore ; message identique que le compte existe ou non.
    return { ok: true, data: { confirmEmail: true }, message: "Compte créé. Consultez votre boîte mail pour confirmer votre adresse, puis connectez-vous." };
  });
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("signIn", async () => {
    const input = parseForm(loginSchema, formData);
    try {
      await getAuth().api.signInEmail({ body: { email: input.email, password: input.password }, headers: await headers() });
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      if (api.status === 403) return failure("email_not_confirmed");
      if (api.status === 429) return failure("rate_limited");
      // Même message pour e-mail inconnu et mot de passe erroné : pas d'énumération de comptes.
      return failure("not_authenticated", undefined, "Adresse e-mail ou mot de passe incorrect.");
    }
    redirect(safeNext(formData.get("next"), "/"));
  });
}

export async function signOutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (error) {
    if (!apiStatus(error)) throw error; // session déjà absente : on redirige quand même
  }
  redirect("/login");
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("passwordReset", async () => {
    const input = parseForm(resetRequestSchema, formData);
    try {
      await getAuth().api.requestPasswordReset({ body: { email: input.email, redirectTo: `${env().SITE_URL}/reset-password` }, headers: await headers() });
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      if (api.status === 429) return failure("rate_limited");
      logger.warn("auth.reset_failed", { status: api.status, code: api.code });
    }
    // Réponse identique que l'adresse existe ou non.
    return { ok: true, data: null, message: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé." };
  });
}

/** Réinitialisation depuis le lien e-mail : toutes les sessions existantes du compte sont révoquées par Better Auth. */
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("resetPassword", async () => {
    const input = parseForm(resetPasswordSchema, formData);
    try {
      await getAuth().api.resetPassword({ body: { newPassword: input.password, token: input.token }, headers: await headers() });
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      if (api.status === 429) return failure("rate_limited");
      return failure("validation", undefined, "Ce lien est invalide, expiré ou déjà utilisé. Demandez un nouveau lien depuis « Mot de passe oublié ».");
    }
    redirect("/login?reset=1");
  });
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("changePassword", async () => {
    await authorizeUser();
    const input = parseForm(changePasswordSchema, formData);
    try {
      await getAuth().api.changePassword({
        body: { currentPassword: input.currentPassword, newPassword: input.password, revokeOtherSessions: true },
        headers: await headers(),
      });
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      if (api.status === 429) return failure("rate_limited");
      if (api.code === "INVALID_PASSWORD") return failure("validation", { currentPassword: "Mot de passe actuel incorrect." });
      logger.warn("auth.change_password_failed", { status: api.status, code: api.code });
      return failure("internal");
    }
    return { ok: true, data: null, message: "Mot de passe mis à jour. Vos autres appareils ont été déconnectés." };
  });
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateProfile", async () => {
    const user = await authorizeUser();
    const input = parseForm(profileSchema, formData);
    try {
      await getAuth().api.updateUser({ body: { name: input.displayName }, headers: await headers() });
    } catch (error) {
      if (!apiStatus(error)) throw error;
      return failure("internal");
    }
    await withUser(user, async (tx) => {
      await tx`update public.profiles set display_name = ${input.displayName} where id = ${user.id}`;
    });
    return { ok: true, data: null, message: "Profil mis à jour." };
  });
}

export async function deleteAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("deleteAccount", async () => {
    const user = await authorizeUser();
    await enforceRateLimit("account-delete", user.id, LIMITS.accountDelete.max, LIMITS.accountDelete.window);
    if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== (user.email ?? "").toLowerCase()) {
      throw new AppError("confirmation_mismatch");
    }
    // Supprime l'utilisateur ET (en cascade) ses sessions et comptes d'authentification.
    await withUser(user, (tx) => tx`select public.delete_my_account()`);
    redirect("/login?deleted=1");
  });
}
