"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError, type ActionResult } from "@/domain/errors";
import { uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import * as bookings from "@/server/repositories/bookings";

type FormState = ActionResult<unknown> | null;

const sessionIdOf = (sessionId: string) => {
  const parsed = uuidField.safeParse(sessionId);
  if (!parsed.success) throw new AppError("not_found");
  return parsed.data;
};

function refresh(academyId: string) {
  revalidatePath(`/a/${academyId}/schedule`);
  revalidatePath(`/a/${academyId}/me`);
  revalidatePath(`/a/${academyId}/dashboard`);
}

/** Réservation de l'adhérent connecté pour une séance : confirmée, ou en liste d'attente si la séance est pleine. */
export async function bookSessionAction(academyId: string, sessionId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("bookSession", async () => {
    const ctx = await authorizeAcademy(academyId);
    const id = sessionIdOf(sessionId);
    const status = await inAcademy(ctx, (tx) => bookings.bookSession(tx, id));
    refresh(academyId);
    return {
      ok: true,
      data: { status },
      // La promotion depuis la liste d'attente est automatique mais n'est pas encore notifiée : ne rien promettre de plus.
      message: status === "booked" ? "Place réservée." : "Séance complète : vous êtes sur la liste d'attente. Si une place se libère, elle vous revient automatiquement, sans notification : vérifiez avant le cours.",
    };
  });
}

export async function cancelBookingAction(academyId: string, sessionId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("cancelBooking", async () => {
    const ctx = await authorizeAcademy(academyId);
    await inAcademy(ctx, (tx) => bookings.cancelBooking(tx, sessionIdOf(sessionId)));
    refresh(academyId);
    return { ok: true, data: null, message: "Réservation annulée." };
  });
}

/** Coach : accorde une place à un membre de la liste d'attente, même au-delà de la capacité. */
export async function promoteBookingAction(academyId: string, input: { sessionId: string; personId: string }): Promise<ActionResult<null>> {
  return runAction("promoteBooking", async () => {
    const ctx = await authorizeAcademy(academyId, "attendance.record");
    const parsed = z.object({ sessionId: uuidField, personId: uuidField }).safeParse(input);
    if (!parsed.success) throw new AppError("not_found");
    await inAcademy(ctx, (tx) => bookings.promoteBooking(tx, parsed.data.sessionId, parsed.data.personId));
    refresh(academyId);
    return { ok: true, data: null, message: "Place accordée." };
  });
}
