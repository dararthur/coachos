"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { expandOccurrences } from "@/domain/schedule";
import { ATTENDANCE_STATUSES, MAX_OCCURRENCES, attendanceSchema, sessionCreateSchema, sessionUpdateSchema, uuidField } from "@/domain/validation";
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
    const ok = await inAcademy(ctx, (tx) =>
      schedule.updateSession(tx, academyId, id.data, {
        instructorId: input.instructorId ?? null,
        date: input.date,
        time: input.time,
        durationMinutes: input.durationMinutes,
        capacity: input.capacity ?? null,
        notes: input.notes ?? null,
      }),
    );
    if (!ok) throw new AppError("not_found");
    // Une capacité augmentée ou retirée fait avancer la liste d'attente : les adhérents promus sont prévenus par e-mail.
    deliverBookingPromotionsAfterResponse();
    revalidatePath(`/a/${academyId}/schedule`);
    // Retour au planning, sur la semaine de la séance, avec un bandeau de confirmation.
    redirect(`/a/${academyId}/schedule?updated=1&week=${input.date}`);
  });
}

async function changeSessionState(academyId: string, sessionId: string, op: "cancel" | "reactivate" | "delete"): Promise<FormState> {
  return runAction(`session.${op}`, async () => {
    const ctx = await authorizeAcademy(academyId, "schedule.manage");
    const id = uuidField.safeParse(sessionId);
    if (!id.success) throw new AppError("not_found");
    const ok = await inAcademy(ctx, (tx) =>
      op === "delete"
        ? schedule.deleteSession(tx, academyId, id.data)
        : schedule.setSessionStatus(tx, academyId, id.data, op === "cancel" ? "cancelled" : "scheduled"),
    );
    if (!ok) throw new AppError("not_found");
    // Une séance annulée prévient ses inscrits (e-mail et notification).
    if (op === "cancel") deliverBookingPromotionsAfterResponse();
    revalidatePath(`/a/${academyId}/schedule`);
    revalidatePath(`/a/${academyId}/attendance`);
    if (op === "delete") redirect(`/a/${academyId}/schedule?deleted=1`);
    return { ok: true, data: null, message: op === "cancel" ? "Séance annulée." : "Séance réactivée." };
  });
}

export async function cancelSessionAction(academyId: string, sessionId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  return changeSessionState(academyId, sessionId, "cancel");
}
export async function reactivateSessionAction(academyId: string, sessionId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  return changeSessionState(academyId, sessionId, "reactivate");
}
export async function deleteSessionAction(academyId: string, sessionId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  return changeSessionState(academyId, sessionId, "delete");
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
