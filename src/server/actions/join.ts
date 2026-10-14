"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure, type ActionResult } from "@/domain/errors";
import { normalizeJoinCode } from "@/domain/join-code";
import { authorizeAcademy, authorizeUser, inAcademy, runAction } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import * as join from "@/server/repositories/join";

type FormState = ActionResult<unknown> | null;

/** Rejoint un club avec son code, saisi dans le formulaire ou repris du lien /join/<code> (champ `code`). */
export async function joinWithCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("joinWithCode", async () => {
    const user = await authorizeUser();
    await enforceRateLimit("join-code", user.id, LIMITS.joinCode.max, LIMITS.joinCode.window);
    const code = normalizeJoinCode(formData.get("code"));
    if (!code) return failure("validation", { code: "Code invalide : 8 caractères, lettres et chiffres." });
    const academyId = await withUser(user, (tx) => join.joinAcademyWithCode(tx, code));
    // La fiche vient d'être créée : « Mon espace » envoie le membre compléter son profil.
    redirect(`/a/${academyId}/me`);
  });
}

export async function regenerateJoinCodeAction(academyId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("regenerateJoinCode", async () => {
    const ctx = await authorizeAcademy(academyId, "academy.update");
    await inAcademy(ctx, (tx) => join.regenerateJoinCode(tx, academyId));
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: "Nouveau code généré. L'ancien code et l'ancien lien ne fonctionnent plus." };
  });
}
