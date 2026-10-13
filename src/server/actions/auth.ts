"use server";

import { redirect } from "next/navigation";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { loginSchema, newPasswordSchema, profileSchema, resetRequestSchema, signupSchema } from "@/domain/validation";
import { createAuthClient } from "@/server/auth/supabase";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { clientIp, enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { parseForm, safeNext } from "./helpers";

type FormState = ActionResult<unknown> | null;

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("signUp", async () => {
    const input = parseForm(signupSchema, formData);
    await enforceRateLimit("signup:ip", await clientIp(), LIMITS.signup.max, LIMITS.signup.window);
    const supabase = await createAuthClient();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${env().SITE_URL}/auth/callback?next=/onboarding`,
        data: { display_name: input.displayName ?? "" },
      },
    });
    if (error) {
      logger.warn("auth.signup_failed", { status: error.status, code: error.code });
      if (error.code === "weak_password") return failure("validation", { password: "Mot de passe trop faible ou compromis." });
      if (error.status === 429) return failure("rate_limited");
      return failure("internal");
    }
    // Avec confirmation par e-mail, aucune session n'existe encore ; message identique que le compte existe ou non.
    if (data.session) redirect("/onboarding");
    return { ok: true, data: { confirmEmail: true }, message: "Compte créé. Consultez votre boîte mail pour confirmer votre adresse, puis connectez-vous." };
  });
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("signIn", async () => {
    const input = parseForm(loginSchema, formData);
    await enforceRateLimit("login:ip", await clientIp(), LIMITS.login.max * 3, LIMITS.login.window);
    await enforceRateLimit("login:email", input.email, LIMITS.login.max, LIMITS.login.window);
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) {
      if (error.code === "email_not_confirmed") return failure("email_not_confirmed");
      if (error.status === 429) return failure("rate_limited");
      // Même message pour e-mail inconnu et mot de passe erroné : pas d'énumération de comptes.
      return failure("not_authenticated", undefined, "Adresse e-mail ou mot de passe incorrect.");
    }
    redirect(safeNext(formData.get("next"), "/"));
  });
}

export async function signOutAction(): Promise<void> {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("passwordReset", async () => {
    const input = parseForm(resetRequestSchema, formData);
    await enforceRateLimit("reset:ip", await clientIp(), LIMITS.passwordReset.max, LIMITS.passwordReset.window);
    await enforceRateLimit("reset:email", input.email, 3, LIMITS.passwordReset.window);
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: `${env().SITE_URL}/auth/callback?next=/reset-password`,
    });
    if (error && error.status === 429) return failure("rate_limited");
    if (error) logger.warn("auth.reset_failed", { status: error.status, code: error.code });
    // Réponse identique que l'adresse existe ou non.
    return { ok: true, data: null, message: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé." };
  });
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updatePassword", async () => {
    await authorizeUser();
    const input = parseForm(newPasswordSchema, formData);
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) {
      if (error.code === "weak_password") return failure("validation", { password: "Mot de passe trop faible ou compromis." });
      if (error.code === "same_password") return failure("validation", { password: "Choisissez un mot de passe différent de l'actuel." });
      logger.warn("auth.update_password_failed", { status: error.status, code: error.code });
      return failure("internal");
    }
    return { ok: true, data: null, message: "Mot de passe mis à jour." };
  });
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateProfile", async () => {
    const user = await authorizeUser();
    const input = parseForm(profileSchema, formData);
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.updateUser({ data: { display_name: input.displayName } });
    if (error) return failure("internal");
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
    await withUser(user, (tx) => tx`select public.delete_my_account()`);
    const supabase = await createAuthClient();
    await supabase.auth.signOut();
    redirect("/login?deleted=1");
  });
}
