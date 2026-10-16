"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { AppError, type ActionResult } from "@/domain/errors";
import { FEATURES, isFeature } from "@/domain/features";
import { subscriptionSchema, uuidField } from "@/domain/validation";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { isPlatformAdminUser } from "@/server/auth/platform-admin";
import { withUser } from "@/server/db/client";
import * as features from "@/server/repositories/features";
import * as subscriptions from "@/server/repositories/subscriptions";
import { parseForm } from "./helpers";
import type { SubscriptionStatus } from "@/domain/billing";

type FormState = ActionResult<unknown> | null;

/**
 * Active ou coupe un module pour un club. Réservé à l'administrateur de la plateforme : tout autre compte reçoit un 404, et la base
 * refuse aussi (42501). Les données du club sont conservées ; le réglage est tracé dans le journal du club.
 */
export async function setClubFeatureAction(academyId: string, feature: string, enabled: boolean, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("setClubFeature", async () => {
    const user = await authorizeUser();
    if (!(await isPlatformAdminUser(user))) notFound();
    const id = uuidField.safeParse(academyId);
    if (!id.success || !isFeature(feature)) throw new AppError("validation");
    await withUser(user, (tx) => features.setClubFeature(tx, id.data, feature, enabled));
    revalidatePath(`/admin/clubs/${id.data}`);
    revalidatePath("/admin");
    return { ok: true, data: null, message: `${FEATURES[feature].label} : ${enabled ? "activé" : "coupé"} pour ce club.` };
  });
}

/** Formule et facturation d'un club. Réservé à l'administrateur de la plateforme (404 pour tout autre compte) ; interne, jamais montré au club. */
export async function setClubSubscriptionAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("setClubSubscription", async () => {
    const user = await authorizeUser();
    if (!(await isPlatformAdminUser(user))) notFound();
    const id = uuidField.safeParse(academyId);
    if (!id.success) throw new AppError("validation");
    const input = parseForm(subscriptionSchema, formData);
    await withUser(user, (tx) =>
      subscriptions.setClubSubscription(tx, id.data, {
        planName: input.planName,
        status: input.status as SubscriptionStatus,
        startsOn: input.startsOn ?? null,
        renewsOn: input.renewsOn ?? null,
        priceCents: input.price,
        note: input.note ?? null,
      }),
    );
    revalidatePath(`/admin/clubs/${id.data}`);
    revalidatePath("/admin");
    return { ok: true, data: null, message: "Formule enregistrée." };
  });
}
