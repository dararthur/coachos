"use server";

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { normalizeJoinCode } from "@/domain/join-code";
import { changePasswordSchema, loginSchema, profileSchema, resetPasswordSchema, resetRequestSchema, signupSchema } from "@/domain/validation";
import { getAuth } from "@/server/auth/auth";
import { apiErrorInfo } from "@/server/auth/api-error";
import { revokeConnectedDevice, revokeOtherConnectedDevices } from "@/server/auth/devices";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { isConfiguredAdminEmail } from "@/server/auth/platform-admin";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { clientIp, enforceRateLimit, LIMITS } from "@/server/rate-limit";
import * as requests from "@/server/repositories/club-requests";
import { parseForm, safeNext } from "./helpers";

type FormState = ActionResult<unknown> | null;

/** Les limites de débit (inscription, connexion, réinitialisation) sont appliquées dans Better Auth (hook), pour tout chemin. */
const apiStatus = apiErrorInfo; // lecture par la forme de l'erreur : voir src/server/auth/api-error.ts

/** Après confirmation de l'e-mail, la connexion reprend le parcours d'inscription à un club (lien /join/<code>). */
function verifiedCallback(next: string): string {
  return next.startsWith("/join/") ? `/login?verified=1&next=${encodeURIComponent(next)}` : "/login?verified=1";
}

/** Réponse de l'inscription SANS code de club : identique que l'adresse soit autorisée ou non (aucune adresse n'est devinable, pas même celle de l'administrateur). */
const SIGNUP_NO_CODE_MESSAGE =
  "Si cette adresse est autorisée à créer un compte (invitation de votre club ou demande de club approuvée), un e-mail de confirmation vient de vous être envoyé. Consultez votre boîte mail, puis connectez-vous.";


/** Dépense un temps comparable à celui du hachage d'un mot de passe, pour qu'un refus ne soit pas plus rapide qu'une inscription acceptée. */
async function spendHashingTime(): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    scryptCallback(randomBytes(16), randomBytes(16), 64, { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 }, (error) => (error ? reject(error) : resolve())),
  );
}

/**
 * Un compte ne se crée qu'avec un « ticket » :
 *   - un CODE de club (saisi, ou repris du lien /join/<code>) : évalué seul ; un code erroné est signalé (limite de débit par IP) ;
 *   - sans code : une invitation en attente ou une demande de club approuvée pour cette adresse, ou l'adresse de l'administrateur de la plateforme.
 * Sans ticket valide, la réponse est la même que pour une inscription acceptée et aucun compte n'est créé ni aucun e-mail envoyé.
 */
export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("signUp", async () => {
    const input = parseForm(signupSchema, formData);
    await enforceRateLimit("signup-ticket", await clientIp(), LIMITS.joinCode.max, LIMITS.joinCode.window);
    const next = safeNext(formData.get("next"), "");
    const fromLink = next.startsWith("/join/") ? next.slice("/join/".length) : null;
    const typedCode = Boolean(input.clubCode) || fromLink !== null;
    const code = normalizeJoinCode(input.clubCode ?? fromLink);
    if (typedCode && !(code && (await requests.joinCodeValid(code)))) {
      return failure("join_code_invalid", { clubCode: "Ce code de club est inconnu. Vérifiez-le auprès de votre coach." });
    }
    if (!typedCode && !(isConfiguredAdminEmail(input.email) || (await requests.signupEmailAllowed(input.email)))) {
      await spendHashingTime();
      return { ok: true, data: { confirmEmail: true }, message: SIGNUP_NO_CODE_MESSAGE };
    }
    try {
      await getAuth().api.signUpEmail({
        body: { name: input.displayName ?? "", email: input.email, password: input.password, callbackURL: verifiedCallback(code ? `/join/${code}` : "") },
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
    return {
      ok: true,
      data: { confirmEmail: true },
      message: code ? "Compte créé. Consultez votre boîte mail pour confirmer votre adresse, puis connectez-vous." : SIGNUP_NO_CODE_MESSAGE,
    };
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
    // Better Auth remplace la session de l'appareil courant : on recharge la page avec le nouveau cookie.
    redirect("/account?updated=password");
  });
}

const sessionId = z.uuid();

/**
 * « Mes appareils connectés » : déconnecte un autre appareil de l'utilisateur. L'identifiant reçu du navigateur n'est jamais
 * cru : il n'est cherché que parmi les sessions de l'utilisateur de la requête (src/server/auth/devices.ts).
 */
export async function revokeDeviceAction(id: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("revokeDevice", async () => {
    const user = await authorizeUser();
    await enforceRateLimit("write", user.id, LIMITS.writes.max, LIMITS.writes.window);
    if (!sessionId.safeParse(id).success) return failure("not_found", undefined, "Cet appareil est déjà déconnecté.");
    let outcome;
    try {
      outcome = await revokeConnectedDevice(getAuth(), await headers(), id);
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      if (api.status === 401) return failure("not_authenticated");
      logger.warn("auth.revoke_device_failed", { status: api.status, code: api.code });
      return failure("internal");
    }
    if (outcome === null) return failure("not_authenticated");
    if (outcome === "current") return failure("invalid_action", undefined, "Pour cet appareil, utilisez « Se déconnecter ».");
    if (outcome === "not_found") return failure("not_found", undefined, "Cet appareil est déjà déconnecté.");
    // La ligne disparaît avec son formulaire : la confirmation s'affiche en tête de la carte (comme ?updated=password).
    redirect("/account?updated=device#appareils");
  });
}

export async function revokeOtherDevicesAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("revokeOtherDevices", async () => {
    const user = await authorizeUser();
    await enforceRateLimit("write", user.id, LIMITS.writes.max, LIMITS.writes.window);
    try {
      if (!(await revokeOtherConnectedDevices(getAuth(), await headers()))) return failure("not_authenticated");
    } catch (error) {
      const api = apiStatus(error);
      if (!api) throw error;
      if (api.status === 401) return failure("not_authenticated");
      logger.warn("auth.revoke_other_devices_failed", { status: api.status, code: api.code });
      return failure("internal");
    }
    redirect("/account?updated=devices#appareils");
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
