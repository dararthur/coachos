"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { AppError, failure, type ActionResult } from "@/domain/errors";
import { claimClubSchema, clubRequestSchema, uuidField } from "@/domain/validation";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { isPlatformAdminUser } from "@/server/auth/platform-admin";
import { withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { clubApprovedEmail, clubRequestEmail } from "@/server/mail/templates";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import * as requests from "@/server/repositories/club-requests";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

/** Message unique, que la demande soit nouvelle, déjà connue ou écartée : rien ne révèle l'état des demandes ni l'existence d'une adresse. */
const RECEIVED = "Votre demande a bien été transmise. Vous recevrez un e-mail à cette adresse dès qu'elle aura été examinée.";

/**
 * Demande de création de club, sans compte. Aucun club n'est créé : l'administrateur de la plateforme reçoit un e-mail et décide.
 * L'adresse de l'administrateur n'apparaît dans aucune réponse, aucun journal ni aucune URL.
 */
export async function requestClubAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("requestClub", async () => {
    // Piège à robots : champ invisible pour les humains. Réponse identique, rien n'est enregistré.
    if (String(formData.get("website") ?? "").trim() !== "") return { ok: true, data: null, message: RECEIVED };
    const input = parseForm(clubRequestSchema, formData);
    const ip = await clientIp();
    await enforceRateLimit("club-request-ip", ip, 5, 60 * 60);
    await enforceRateLimit("club-request-email", input.email, 3, 24 * 60 * 60);
    let isNew = false;
    try {
      ({ isNew } = await requests.submitClubRequest({
        name: input.name,
        timezone: input.timezone,
        currency: input.currency,
        contactName: input.contactName,
        email: input.email,
        note: input.note ?? null,
      }));
    } catch (error) {
      if (!(error instanceof AppError && error.code === "academy_request_limit")) throw error;
    }
    const admin = env().PLATFORM_ADMIN_EMAIL;
    if (isNew && admin) {
      const message = clubRequestEmail(admin, `${env().SITE_URL}/admin/club-requests`, { clubName: input.name, contactName: input.contactName, contactEmail: input.email });
      void getMailer().send(message).catch(() => logger.warn("club_request.mail_failed", { kind: "club_request" }));
    }
    return { ok: true, data: null, message: RECEIVED };
  });
}

/** Approuver ou refuser une demande : réservé à l'administrateur de la plateforme (404 pour tout autre compte). */
export async function decideClubRequestAction(requestId: string, approve: boolean, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("decideClubRequest", async () => {
    const user = await authorizeUser();
    if (!(await isPlatformAdminUser(user))) notFound();
    const id = uuidField.parse(requestId);
    const decided = await withUser(user, (tx) => requests.decideClubRequest(tx, id, approve));
    if (approve) {
      void getMailer()
        .send(clubApprovedEmail(decided.email, `${env().SITE_URL}/signup`, decided.name))
        .catch(() => logger.warn("club_request.mail_failed", { kind: "club_approved" }));
    }
    revalidatePath("/admin/club-requests");
    return { ok: true, data: null, message: approve ? "Demande approuvée : le demandeur a reçu un e-mail." : "Demande refusée." };
  });
}

/** Création du club une fois la demande approuvée (le demandeur peut corriger le nom, le fuseau et la devise). */
export async function claimClubAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("claimClub", async () => {
    const user = await authorizeUser();
    const input = parseForm(claimClubSchema, formData);
    let id: string;
    try {
      id = await withUser(user, (tx) => requests.claimClubRequest(tx, { requestId: input.requestId, name: input.name, timezone: input.timezone, currency: input.currency }));
    } catch (error) {
      if (error instanceof AppError && error.code === "not_found") return failure("not_found", undefined, "Cette demande n'est pas (ou plus) approuvée pour votre compte.");
      throw error;
    }
    redirect(`/a/${id}/dashboard`);
  });
}
