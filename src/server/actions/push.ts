"use server";

import { AppError, type ActionResult } from "@/domain/errors";
import { pushSubscriptionSchema } from "@/domain/push";
import { runAction } from "@/server/auth/guards";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { deliverPush, vapidPublicKey, type PushTarget } from "@/server/push";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";

async function currentUser() {
  const user = await getSessionUser();
  if (!user) throw new AppError("not_authenticated");
  await enforceRateLimit("write", user.id, LIMITS.writes.max, LIMITS.writes.window);
  return user;
}

/** Enregistre l'appareil courant pour le compte connecté (un appareil déjà abonné pour un autre compte passe au compte courant). */
export async function savePushSubscriptionAction(subscription: unknown): Promise<ActionResult> {
  return runAction("savePushSubscription", async () => {
    const user = await currentUser();
    if (!vapidPublicKey()) throw new AppError("not_found");
    const parsed = pushSubscriptionSchema.safeParse(subscription);
    if (!parsed.success) throw new AppError("validation");
    const { endpoint, keys } = parsed.data;
    await withUser(user, (tx) => tx`select app_private.save_push_subscription(${endpoint}, ${keys.p256dh}, ${keys.auth})`);
    return { ok: true, data: undefined };
  });
}

/** Retire l'appareil courant (la RLS ne laisse supprimer que ses propres appareils). */
export async function removePushSubscriptionAction(endpoint: unknown): Promise<ActionResult> {
  return runAction("removePushSubscription", async () => {
    const user = await currentUser();
    if (typeof endpoint !== "string" || endpoint.length > 1000) throw new AppError("validation");
    await withUser(user, (tx) => tx`delete from public.push_subscriptions where endpoint = ${endpoint}`);
    return { ok: true, data: undefined };
  });
}

/** Envoie une notification d'essai aux appareils du compte connecté. */
export async function sendTestPushAction(): Promise<ActionResult> {
  return runAction("sendTestPush", async () => {
    const user = await currentUser();
    if (!vapidPublicKey()) throw new AppError("not_found");
    const targets = await withUser(user, (tx) => tx<PushTarget[]>`select id, endpoint, p256dh, auth from public.push_subscriptions order by created_at desc`);
    if (targets.length === 0) return { ok: true, data: undefined, message: "Aucun appareil n'est abonné : activez d'abord les notifications." };
    const result = await deliverPush(targets, { title: "Matnexa", body: "Les notifications fonctionnent sur cet appareil.", url: "/account" });
    if (result.gone.length > 0) await withUser(user, (tx) => tx`delete from public.push_subscriptions where id = any(${tx.array(result.gone)}::uuid[])`);
    if (result.sent === 0) throw new AppError("internal", { message: "L'envoi a échoué. Désactivez puis réactivez les notifications sur cet appareil." });
    return { ok: true, data: undefined, message: "Notification envoyée : elle doit apparaître dans quelques secondes." };
  });
}
