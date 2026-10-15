"use client";

import { savePushSubscriptionAction } from "@/server/actions/push";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

export function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(nav.standalone);
}

function isIos(): boolean {
  const nav = window.navigator;
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** État des notifications sur CET appareil (lecture seule : ne demande rien au navigateur). */
export async function detectPush(): Promise<PushState> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // Sur iPhone et iPad, Safari n'offre les notifications qu'aux applications installées sur l'écran d'accueil.
  if (!supported) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type EnableResult = { ok: true } | { ok: false; state: "denied" | "off" | "failed" };

/** À appeler depuis un geste de l'utilisateur (clic) : demande la permission, abonne l'appareil et l'enregistre. */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, state: permission === "denied" ? "denied" : "off" };
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    const result = await savePushSubscriptionAction(subscription.toJSON());
    if (!result.ok) {
      await subscription.unsubscribe();
      return { ok: false, state: "failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, state: "failed" };
  }
}
