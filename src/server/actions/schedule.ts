"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { expandOccurrences } from "@/domain/schedule";
import { ATTENDANCE_STATUSES, MAX_OCCURRENCES, attendanceSchema, sessionCreateSchema, sessionRemoveSchema, sessionUpdateSchema, uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import { deliverBookingPromotionsAfterResponse } from "@/server/booking-notifications";
import * as attendance from "@/server/repositories/attendance";
import * as schedule from "@/server/repositories/schedule";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

export async function createSessionsAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("createSessions", async () => {
    const ctx = await authorizeAcademy(academyId, "schedule.manage");
    const input = parseForm(sessionCreateSchema, formData);
    const dates = expandOccurrences({ date: input.date, repeat: input.repeat, weekdays: input.weekdays, until: input.until });
    if (dates.length === 0) return failure("validation", { weekdays: "Aucune date ne correspond aux jours choisis." });
    if (dates.length > MAX_OCCURRENCES) return failure("validation", { until: `Trop de séances (${MAX_OCCURRENCES} maximum à la fois).` });

    const result = await inAcademy(ctx, (tx) =>
      schedule.createSessions(tx, academyId, {
        classTypeId: input.classTypeId,
        instructorId: input.instructorId ?? null,
        dates,
        time: input.time,
        durationMinutes: input.durationMinutes,
        capacity: input.capacity ?? null,
        notes: input.notes ?? null,
      }),
    );
    revalidatePath(`/a/${academyId}/schedule`);
    if (result.created === 0) {
      return failure("duplicate", undefined, "Ces séances existent déjà : rien n'a été créé.");
    }
    const skipped = result.skipped > 0 ? ` ${result.skipped} existaient déjà et ont été ignorées.` : "";
    // La semaine de la première séance : la nouvelle séance est visible tout de suite, même si elle tombe dans une autre semaine.
    redirect(`/a/${academyId}/schedule?created=${result.created}${skipped ? `&skipped=${result.skipped}` : ""}&week=${dates[0]}`);
  });
}

export async function updateSessionAction(academyId: string, sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateSession", async () => {
    const ctx = await authorizeAcademy(academyId, "schedule.manage");
    const id = uuidField.safeParse(sessionId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(sessionUpdateSchema, formData);
    const fields = { instructorId: input.instructorId ?? null, time: input.time, durationMinutes: input.durationMinutes, capacity: input.capacity ?? null, notes: input.notes ?? null };
    let changed = 1;
    try {
      changed = await inAcademy(ctx, async (tx) => {
        if (input.scope === "this") return (await schedule.updateSession(tx, academyId, id.data, { ...fields, date: input.date })) ? 1 : 0;
        // Plusieurs séances : chacune garde son jour (la date saisie ne concerne que la séance seule).
        return schedule.updateSessionSeries(tx, academyId, id.data, input.scope, fields);
      });
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", undefined, "Une autre séance du même cours existe déjà à cet horaire : rien n'a été modifié.");
      throw e;
    }
    if (changed === 0) throw new AppError("not_found", { message: input.scope === "this" ? undefined : "Aucune séance à venir dans cette série : rien n'a été modifié." });
    // Une capacité augmentée ou retirée fait avancer la liste d'attente : les adhérents promus sont prévenus par e-mail.
    deliverBookingPromotionsAfterResponse();
    revalidatePath(`/a/${academyId}/schedule`);
    // Retour au planning, sur la semaine de la séance, avec un bandeau de confirmation.
    redirect(`/a/${academyId}/schedule?updated=${changed}&week=${input.date}`);
  });
}

async function changeSessionState(academyId: string, sessionId: string, op: "cancel" | "reactivate"): Promise<FormState> {
  return runAction(`session.${op}`, async () => {
    const ctx = await authorizeAcademy(academyId, "schedule.manage");
    const id = uuidField.safeParse(sessionId);
    if (!id.success) throw new AppError("not_found");
    const ok = await inAcademy(ctx, (tx) => schedule.setSessionStatus(tx, academyId, id.data, op === "cancel" ? "cancelled" : "scheduled"));
    if (!ok) throw new AppError("not_found");
    // Une séance annulée prévient ses inscrits (e-mail et notification).
    if (op === "cancel") deliverBookingPromotionsAfterResponse();
    revalidatePath(`/a/${academyId}/schedule`);
    revalidatePath(`/a/${academyId}/attendance`);
    return { ok: true, data: null, message: op === "cancel" ? "Séance annulée." : "Séance réactivée." };
  });
}

export async function cancelSessionAction(academyId: string, sessionId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  return changeSessionState(academyId, sessionId, "cancel");
}
export async function reactivateSessionAction(academyId: string, sessionId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  return changeSessionState(academyId, sessionId, "reactivate");
}
/**
 * Suppression d'une séance, ou de plusieurs séances de sa série (portée choisie). Une séance programmée qui a des inscrits est ANNULÉE
 * (ses inscrits sont prévenus) au lieu d'être supprimée en silence ; une séance avec des présences n'est jamais supprimée.
 */
export async function deleteSessionAction(academyId: string, sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("session.delete", async () => {
    const ctx = await authorizeAcademy(academyId, "schedule.manage");
    const id = uuidField.safeParse(sessionId);
    if (!id.success) throw new AppError("not_found");
    const { scope } = parseForm(sessionRemoveSchema, formData);
    const r = await inAcademy(ctx, (tx) => schedule.removeSessions(tx, academyId, id.data, scope));
    if (r.deleted === 0 && r.cancelled === 0) {
      return failure("not_found", undefined, scope === "this" ? "Cette séance ne peut pas être supprimée (présences enregistrées) : elle reste au planning." : "Aucune séance à venir à retirer dans cette série.");
    }
    if (r.cancelled > 0) deliverBookingPromotionsAfterResponse(); // annulations : les inscrits sont prévenus
    revalidatePath(`/a/${academyId}/schedule`);
    revalidatePath(`/a/${academyId}/attendance`);
    redirect(`/a/${academyId}/schedule?removed=${r.deleted}&cancelledInstead=${r.cancelled}`);
  });
}

// --- Présences ----------------------------------------------------------------------------------
export interface AttendanceUpdate {
  personId: string;
  status: (typeof ATTENDANCE_STATUSES)[number] | null;
}

/** Appelée depuis la feuille d'appel (client) : renvoie l'état confirmé par la base, jamais un succès supposé. */
export async function setAttendanceAction(academyId: string, input: { sessionId: string; personId: string; status: string }): Promise<ActionResult<AttendanceUpdate>> {
  return runAction("setAttendance", async () => {
    const ctx = await authorizeAcademy(academyId, "attendance.record");
    const parsed = attendanceSchema.safeParse(input);
    if (!parsed.success) return failure("validation");
    const status = parsed.data.status === "none" ? null : parsed.data.status;
    const ok = await inAcademy(ctx, async (tx) => {
      // Effacer reste possible (correction) ; enregistrer une présence attend le jour du cours.
      if (status !== null && (await attendance.isUpcomingDay(tx, academyId, parsed.data.sessionId))) throw new AppError("attendance_too_early");
      return attendance.setAttendance(tx, academyId, parsed.data.sessionId, parsed.data.personId, status);
    });
    if (!ok) throw new AppError("not_found");
    return { ok: true, data: { personId: parsed.data.personId, status } };
  });
}

const sessionIdSchema = z.object({ sessionId: uuidField });

export async function markRemainingPresentAction(academyId: string, input: { sessionId: string; onlyBooked?: boolean }): Promise<ActionResult<{ marked: number }>> {
  return runAction("markRemainingPresent", async () => {
    const ctx = await authorizeAcademy(academyId, "attendance.record");
    const parsed = sessionIdSchema.safeParse(input);
    if (!parsed.success) return failure("validation");
    const marked = await inAcademy(ctx, async (tx) => {
      if (await attendance.isUpcomingDay(tx, academyId, parsed.data.sessionId)) throw new AppError("attendance_too_early");
      return attendance.markRemainingPresent(tx, academyId, parsed.data.sessionId, input.onlyBooked === true);
    });
    return { ok: true, data: { marked } };
  });
}
