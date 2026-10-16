"use server";

import { createHmac, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { failure, type ActionResult } from "@/domain/errors";
import { clearAdminProof, issueAdminProof } from "@/server/auth/admin-proof";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { isPlatformAdminAccount } from "@/server/auth/platform-admin";
import type { SessionUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { adminCodeEmail } from "@/server/mail/templates";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { adminCodeCheck, adminCodeIssue } from "@/server/repositories/admin-2fa";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

const CODE_TTL_SECONDS = 10 * 60;
const codeSchema = z.object({ code: z.string().trim().min(1).max(20) });
const WRONG_CODE = "Code incorrect, expiré ou déjà utilisé. Demandez-en un nouveau.";

/** Empreinte du code, liée au compte ET à la session : un code demandé depuis une autre session ne vaut rien ici. */
function codeHash(user: SessionUser, code: string): string {
  return createHmac("sha256", env().APP_SECRET).update(`admin-code|${user.id}|${user.sessionId}|${code}`).digest("hex");
}

/** Compte désigné administrateur (par e-mail confirmé) ; tout autre compte reçoit un 404. Ne préjuge pas de la seconde authentification. */
async function adminAccount(): Promise<SessionUser> {
  const user = await authorizeUser();
  if (!(await isPlatformAdminAccount(user))) notFound();
  return user;
}

/** Destination après vérification : uniquement l'administration (jamais une URL externe ni une autre page de l'application). */
function adminNext(next: string): string {
  return /^\/admin(\/[A-Za-z0-9_\-/]*)?$/.test(next) && !next.startsWith("/admin/security") ? next : "/admin";
}

/**
 * Envoie un code à 6 chiffres à l'adresse du compte. Action explicite (jamais déclenchée par l'affichage d'une page) et limitée :
 * 3 envois par quart d'heure. Un nouvel envoi invalide le précédent.
 */
export async function sendAdminCodeAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("sendAdminCode", async () => {
    const user = await adminAccount();
    await enforceRateLimit("admin-code-send", user.id, 3, 15 * 60);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await adminCodeIssue(user.id, user.sessionId, codeHash(user, code), CODE_TTL_SECONDS);
    try {
      await getMailer().send(adminCodeEmail(user.email!, code, `${env().SITE_URL}/admin/security`));
    } catch {
      logger.warn("admin_code.mail_failed", { kind: "admin_code" });
      return failure("mail_failed");
    }
    revalidatePath("/admin/security");
    return { ok: true, data: null, message: "Code envoyé à l'adresse de votre compte. Il est valable 10 minutes." };
  });
}

/** Saisie du code reçu : ouvre l'administration pour 8 heures sur cet appareil (cookie signé, lié à la session). */
export async function verifyAdminCodeAction(next: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("verifyAdminCode", async () => {
    const user = await adminAccount();
    await enforceRateLimit("admin-code-verify", user.id, 10, 15 * 60);
    await enforceRateLimit("admin-code-verify-ip", await clientIp(), 30, 60 * 60);
    const { code } = parseForm(codeSchema, formData);
    const clean = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(clean) || !(await adminCodeCheck(user.id, user.sessionId, codeHash(user, clean)))) return failure("validation", { code: WRONG_CODE });
    await issueAdminProof(user);
    redirect(adminNext(next));
  });
}

/** Verrouille l'administration sur cet appareil (la preuve est effacée ; le prochain accès redemande un code). */
export async function lockAdminAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("lockAdmin", async () => {
    await adminAccount();
    await clearAdminProof();
    redirect("/account");
  });
}
