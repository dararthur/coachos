"use client";

import { useEffect, useState } from "react";
import { removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/server/actions/push";
import { buttonClasses } from "./button-classes";

type State = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on";
type Notice = { tone: "ok" | "error"; text: string };

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(nav.standalone);
}

function isIos(): boolean {
  const nav = window.navigator;
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

async function detect(): Promise<State> {
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

/**
 * Activation des notifications sur CET appareil (chaque téléphone ou ordinateur s'abonne séparément). Rien n'est demandé au
 * navigateur avant le clic : la permission est sollicitée au moment où l'utilisateur choisit d'activer.
 */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let alive = true;
    detect()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setNotice(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const result = await savePushSubscriptionAction(subscription.toJSON());
      if (!result.ok) {
        await subscription.unsubscribe();
        setNotice({ tone: "error", text: "L'activation a échoué. Réessayez dans un instant." });
        return;
      }
      setState("on");
      setNotice({ tone: "ok", text: "Notifications activées sur cet appareil." });
    } catch {
      setNotice({ tone: "error", text: "Ce navigateur n'a pas pu activer les notifications." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
      setNotice({ tone: "ok", text: "Notifications désactivées sur cet appareil." });
    } catch {
      setNotice({ tone: "error", text: "La désactivation a échoué. Réessayez dans un instant." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendTestPushAction();
      setNotice(result.ok ? { tone: "ok", text: result.message ?? "Notification envoyée." } : { tone: "error", text: result.error });
    } catch {
      setNotice({ tone: "error", text: "L'essai a échoué. Réessayez dans un instant." });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <div className="min-h-11" aria-hidden />;

  return (
    <div className="space-y-3">
      {state === "unsupported" && <p className="text-sm text-ink-soft">Ce navigateur ne permet pas les notifications. Essayez avec Chrome, Edge, Firefox ou Safari à jour.</p>}
      {state === "needs-install" && (
        <p className="text-sm text-ink-soft">
          Sur iPhone et iPad, les notifications ne marchent que depuis l&apos;application installée : touchez Partager puis « Sur l&apos;écran d&apos;accueil », ouvrez Matnexa depuis l&apos;icône, puis revenez ici.
        </p>
      )}
      {state === "denied" && (
        <p className="text-sm text-ink-soft">Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (ou de l&apos;application), puis rechargez cette page.</p>
      )}
      {state === "off" && (
        <>
          <p className="text-sm text-ink-soft">Recevez sur cet appareil les annonces de vos clubs, même quand l&apos;application est fermée.</p>
          <button type="button" onClick={enable} disabled={busy} className={buttonClasses({ variant: "primary" })}>
            {busy ? "Activation…" : "Activer les notifications"}
          </button>
        </>
      )}
      {state === "on" && (
        <>
          <p className="text-sm text-ink-soft">Les notifications sont activées sur cet appareil.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={test} disabled={busy} className={buttonClasses({ variant: "secondary" })}>
              Envoyer une notification d&apos;essai
            </button>
            <button type="button" onClick={disable} disabled={busy} className={buttonClasses({ variant: "secondary" })}>
              Désactiver
            </button>
          </div>
        </>
      )}
      <p role="status" className={notice ? (notice.tone === "ok" ? "text-sm font-semibold text-ink" : "text-sm font-semibold text-danger") : "sr-only"}>
        {notice?.text}
      </p>
    </div>
  );
}
