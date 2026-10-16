"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_IMPORT_BYTES, analyzeImport, planImport, type ImportRow, type RowIssue } from "@/domain/csv-import";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { archiveSchema, beltSinceSchema, guardianUpdateSchema, myProfileSchema, pauseSchema, promotionSchema, personCreateSchema, personUpdateSchema, uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import { deliverBookingPromotionsAfterResponse } from "@/server/booking-notifications";
import { newConsentToken, sendGuardianConsent } from "@/server/guardian-consent";
import * as graduation from "@/server/repositories/graduation";
import * as members from "@/server/repositories/members";
import * as profile from "@/server/repositories/profile";
import * as ranking from "@/server/repositories/ranking";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

export async function createMemberAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("createMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.create");
    const input = parseForm(personCreateSchema, formData);
    let id: string;
    let consent: "sent" | "failed" | null = null;
    try {
      if (input.ageGroup === "minor") {
        // Mineur : responsable légal obligatoire, lien d'accord envoyé à SON adresse (jamais à celle de l'enfant).
        const guardian = { name: input.guardianName!, email: input.guardianEmail!, phone: input.guardianPhone ?? null };
        const { token, hash } = newConsentToken();
        id = await inAcademy(ctx, (tx) =>
          members.createMinor(tx, academyId, { firstName: input.firstName, lastName: input.lastName, birthDate: input.birthDate!, joinedOn: input.joinedOn ?? null, externalRef: null, guardian }, hash),
        );
        const sent = await sendGuardianConsent({ token, guardianEmail: guardian.email, childFirstName: input.firstName, academyName: ctx.academy.name });
        consent = sent ? "sent" : "failed";
      } else {
        id = await inAcademy(ctx, (tx) =>
          members.createPerson(tx, academyId, {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email ?? null,
            phone: input.phone ?? null,
            joinedOn: input.joinedOn ?? null,
          }),
        );
      }
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", { email: "Un membre avec cet e-mail existe déjà." });
      throw e;
    }
    revalidatePath(`/a/${academyId}/members`);
    redirect(`/a/${academyId}/members/${id}?created=1${consent ? `&consent=${consent}` : ""}`);
  });
}

export async function updateMemberAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.update");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(personUpdateSchema, formData);
    let ok: boolean;
    try {
      ok = await inAcademy(ctx, (tx) =>
        members.updatePerson(tx, academyId, id.data, {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          joinedOn: input.joinedOn ?? null,
          belt: input.belt ?? null,
          beltStripes: input.beltStripes ?? 0,
        }),
      );
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", { email: "Un autre membre utilise déjà cet e-mail." });
      throw e;
    }
    if (!ok) throw new AppError("not_found");
    revalidatePath(`/a/${academyId}/members`);
    return { ok: true, data: null, message: "Fiche mise à jour." };
  });
}

/** Renvoie le lien d'accord au responsable légal (le lien précédent cesse de fonctionner). */
export async function resendGuardianConsentAction(academyId: string, personId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("resendGuardianConsent", async () => {
    const ctx = await authorizeAcademy(academyId, "members.create");
    await enforceRateLimit("guardian-consent", ctx.user.id, LIMITS.invitation.max, LIMITS.invitation.window);
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const { token, hash } = newConsentToken();
    const { email, firstName } = await inAcademy(ctx, async (tx) => {
      const person = await members.getPerson(tx, academyId, id.data);
      if (!person) throw new AppError("not_found");
      return { email: await members.renewGuardianConsent(tx, id.data, hash), firstName: person.firstName };
    });
    const sent = await sendGuardianConsent({ token, guardianEmail: email, childFirstName: firstName, academyName: ctx.academy.name });
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return sent ? { ok: true, data: null, message: "Lien envoyé au responsable légal." } : failure("mail_failed", { _form: "Le lien n'a pas pu être envoyé. Réessayez dans quelques minutes." });
  });
}

export async function updateGuardianAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateGuardian", async () => {
    const ctx = await authorizeAcademy(academyId, "members.create");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(guardianUpdateSchema, formData);
    await inAcademy(ctx, (tx) => members.updateGuardian(tx, id.data, { name: input.guardianName, email: input.guardianEmail, phone: input.guardianPhone ?? null }));
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return { ok: true, data: null, message: "Responsable légal mis à jour. Si l'adresse a changé, renvoyez le lien d'accord." };
  });
}

/** L'administrateur retire l'accord (à la demande du responsable) : fiche archivée, classement et photo supprimés. */
export async function withdrawGuardianConsentAction(academyId: string, personId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("withdrawGuardianConsent", async () => {
    const ctx = await authorizeAcademy(academyId, "members.update");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    await inAcademy(ctx, (tx) => members.withdrawGuardianConsent(tx, id.data));
    revalidatePath(`/a/${academyId}/members`);
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return { ok: true, data: null, message: "Accord retiré : la fiche est archivée." };
  });
}

export async function setMemberArchivedAction(academyId: string, personId: string, archive: boolean, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("archiveMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.update");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    // Motif de départ (liste fermée, sans catégorie de santé) : seulement à l'archivage.
    const reason = archive ? (parseForm(archiveSchema, formData).departureReason ?? null) : null;
    const ok = await inAcademy(ctx, (tx) => members.setPersonArchived(tx, academyId, id.data, archive, reason));
    if (!ok) throw new AppError("not_found");
    // Les places réservées d'un membre archivé reviennent à la liste d'attente : les adhérents promus sont prévenus.
    if (archive) deliverBookingPromotionsAfterResponse();
    revalidatePath(`/a/${academyId}/members`);
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return { ok: true, data: null, message: archive ? "Membre archivé." : "Membre restauré." };
  });
}

/** Passage de ceinture ou de barrette enregistré par l'équipe, à la date choisie (propriétaire, administrateur, coach). */
export async function recordPromotionAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("recordPromotion", async () => {
    const ctx = await authorizeAcademy(academyId, "members.grade", "reports");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(promotionSchema, formData);
    await inAcademy(ctx, (tx) => graduation.recordPromotion(tx, id.data, input.belt, input.stripes, input.on));
    revalidatePath(`/a/${academyId}/members/${personId}`);
    revalidatePath(`/a/${academyId}/dashboard`);
    return { ok: true, data: null, message: "Passage enregistré." };
  });
}

/** Confirme (ou corrige) la date à laquelle la personne a reçu sa ceinture actuelle : elle sert au calcul de l'éligibilité. */
export async function setBeltSinceAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("setBeltSince", async () => {
    const ctx = await authorizeAcademy(academyId, "members.grade", "reports");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(beltSinceSchema, formData);
    await inAcademy(ctx, (tx) => graduation.setBeltSince(tx, id.data, input.on));
    revalidatePath(`/a/${academyId}/members/${personId}`);
    revalidatePath(`/a/${academyId}/dashboard`);
    return { ok: true, data: null, message: "Date enregistrée." };
  });
}

/** Pause d'un adhérent posée par le staff (propriétaire, administrateur, coach). */
export async function setMemberPauseAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("setMemberPause", async () => {
    const ctx = await authorizeAcademy(academyId, "members.pause");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(pauseSchema, formData);
    await inAcademy(ctx, (tx) => members.setMemberPause(tx, id.data, input.until, input.reason, input.consent === "on"));
    revalidatePath(`/a/${academyId}/members`);
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return { ok: true, data: null, message: "Pause enregistrée." };
  });
}

export async function clearMemberPauseAction(academyId: string, personId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("clearMemberPause", async () => {
    const ctx = await authorizeAcademy(academyId, "members.pause");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    await inAcademy(ctx, (tx) => members.clearMemberPause(tx, id.data));
    revalidatePath(`/a/${academyId}/members`);
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return { ok: true, data: null, message: "Pause levée." };
  });
}

/** Ma pause : l'adhérent la déclare lui-même (« Mon profil »). */
export async function setMyPauseAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("setMyPause", async () => {
    const ctx = await authorizeAcademy(academyId);
    const input = parseForm(pauseSchema, formData);
    await inAcademy(ctx, (tx) => profile.setMyPause(tx, academyId, input.until, input.reason, input.consent === "on"));
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Pause enregistrée. À bientôt sur le tapis !" };
  });
}

export async function clearMyPauseAction(academyId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("clearMyPause", async () => {
    const ctx = await authorizeAcademy(academyId);
    await inAcademy(ctx, (tx) => profile.clearMyPause(tx, academyId));
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Pause levée : content de vous revoir !" };
  });
}

const eraseSchema = z.object({ mode: z.enum(["anonymize", "delete"], { error: "Choisissez un mode." }), confirm: z.literal("on", { error: "Confirmation requise." }) });

export async function eraseMemberAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("eraseMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.erase");
    await enforceRateLimit("erase", ctx.user.id, LIMITS.erase.max, LIMITS.erase.window);
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(eraseSchema, formData);
    await inAcademy(ctx, (tx) => members.erasePerson(tx, id.data, input.mode));
    deliverBookingPromotionsAfterResponse();
    revalidatePath(`/a/${academyId}/members`);
    redirect(`/a/${academyId}/members?erased=${input.mode}`);
  });
}

// --- Import CSV ---------------------------------------------------------------------------------
export interface ImportReport {
  mode: "preview" | "commit";
  fatal: string | null;
  totalRows: number;
  valid: number;
  toCreate: number;
  created: number;
  /** Parmi les créations : mineurs (lien d'accord envoyé au responsable) et envois en échec. */
  minors: number;
  consentFailed: number;
  ignoredColumns: string[];
  invalid: RowIssue[];
  duplicatesInFile: RowIssue[];
  skippedExisting: RowIssue[];
  possibleHomonyms: RowIssue[];
  sample: Pick<ImportRow, "line" | "firstName" | "lastName" | "email" | "phone" | "joinedOn" | "externalRef" | "birthDate">[];
}

const REPORT_LIST_LIMIT = 50;
const limited = (issues: RowIssue[]) => issues.slice(0, REPORT_LIST_LIMIT);

/**
 * Importe un CSV de membres. Deux étapes avec le même code : « preview » ne modifie rien ;
 * « commit » revalide TOUT côté serveur à partir du fichier (rien venant du navigateur n'est cru).
 */
export async function importMembersAction(academyId: string, _prev: ActionResult<ImportReport> | null, formData: FormData): Promise<ActionResult<ImportReport>> {
  return runAction("importMembers", async () => {
    const ctx = await authorizeAcademy(academyId, "members.import");
    await enforceRateLimit("import", ctx.user.id, LIMITS.importCsv.max, LIMITS.importCsv.window);
    const mode = formData.get("mode") === "commit" ? "commit" : "preview";

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return failure("validation", { file: "Choisissez un fichier CSV." });
    if (file.size > MAX_IMPORT_BYTES) return failure("payload_too_large", { file: "Fichier trop volumineux (1 Mo maximum)." });
    if (!/\.(csv|txt)$/i.test(file.name) && !["text/csv", "text/plain", "application/vnd.ms-excel", ""].includes(file.type)) {
      return failure("validation", { file: "Format non pris en charge : fournissez un fichier .csv." });
    }
    if (mode === "commit" && formData.get("adultConfirmed") !== "on") {
      return failure("validation", { adultConfirmed: "Vous devez attester que les membres sans date de naissance de mineur sont majeurs." });
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      return failure("validation", { file: "Le fichier doit être encodé en UTF-8." });
    }
    const analysis = analyzeImport(text);
    const empty: ImportReport = {
      mode, fatal: analysis.fatal, totalRows: analysis.totalRows, valid: analysis.rows.length, toCreate: 0, created: 0, minors: 0, consentFailed: 0,
      ignoredColumns: analysis.ignoredColumns, invalid: limited(analysis.invalid), duplicatesInFile: limited(analysis.duplicatesInFile),
      skippedExisting: [], possibleHomonyms: [], sample: [],
    };
    if (analysis.fatal) return { ok: true, data: empty };

    const report = await inAcademy(ctx, async (tx) => {
      const existing = await members.findExistingKeys(tx, academyId, analysis.rows);
      const plan = planImport(analysis.rows, existing);
      let created = 0;
      const pending: Parameters<typeof sendGuardianConsent>[0][] = [];
      if (mode === "commit") {
        created = await members.insertImported(tx, academyId, plan.toCreate);
        for (const row of plan.toCreate) {
          if (!row.birthDate || !row.guardian) continue;
          const { token, hash } = newConsentToken();
          await members.createMinor(tx, academyId, { firstName: row.firstName, lastName: row.lastName, birthDate: row.birthDate, joinedOn: row.joinedOn, externalRef: row.externalRef, guardian: row.guardian }, hash);
          pending.push({ token, guardianEmail: row.guardian.email, childFirstName: row.firstName, academyName: ctx.academy.name });
          created++;
        }
        await members.recordEvent(tx, academyId, "members.imported", {
          rows: analysis.totalRows, created, invalid: analysis.invalid.length, duplicates: analysis.duplicatesInFile.length + plan.skippedExisting.length,
        });
      }
      return { plan, created, pending };
    });

    // E-mails après validation de la transaction : un échec d'envoi n'annule pas l'import (le lien se renvoie depuis la fiche).
    let consentFailed = 0;
    for (const p of report.pending) if (!(await sendGuardianConsent(p))) consentFailed++;
    if (mode === "commit") revalidatePath(`/a/${academyId}/members`);
    return {
      ok: true,
      data: {
        ...empty,
        toCreate: report.plan.toCreate.length,
        created: report.created,
        minors: mode === "commit" ? report.pending.length : report.plan.toCreate.filter((r) => r.birthDate).length,
        consentFailed,
        skippedExisting: limited(report.plan.skippedExisting),
        possibleHomonyms: limited(report.plan.possibleHomonyms),
        sample: report.plan.toCreate.slice(0, 10),
      },
    };
  });
}

export async function setRankingVisibilityAction(academyId: string, visible: boolean, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("setRankingVisibility", async () => {
    const ctx = await authorizeAcademy(academyId, undefined, "ranking");
    await inAcademy(ctx, (tx) => ranking.setMyRankingVisibility(tx, academyId, visible));
    revalidatePath(`/a/${academyId}/ranking`);
    revalidatePath(`/a/${academyId}/profile`);
    return { ok: true, data: null, message: visible ? "Vous apparaissez dans le classement." : "Vous n'apparaissez plus dans le classement des autres membres." };
  });
}

export async function updateMyProfileAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateMyProfile", async () => {
    const ctx = await authorizeAcademy(academyId);
    const input = parseForm(myProfileSchema, formData);
    try {
      await inAcademy(ctx, (tx) =>
        profile.updateMyProfile(tx, academyId, {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          belt: input.belt ?? null,
          beltStripes: input.belt ? (input.beltStripes ?? 0) : 0,
          avatarStyle: input.avatarStyle,
          adultConfirmed: input.adultConfirmed === "on",
        }),
      );
    } catch (e) {
      if (e instanceof AppError && e.code === "adult_required") return failure("adult_required", { adultConfirmed: "Cochez la case pour confirmer." });
      throw e;
    }
    revalidatePath(`/a/${academyId}`, "layout");
    // Première validation : l'adhérent arrive enfin sur « Mon espace » (ses cours), au lieu de rester sur le formulaire.
    if (formData.get("first") === "1") redirect(`/a/${academyId}/me?welcome=1`);
    return { ok: true, data: null, message: "Profil enregistré." };
  });
}
