"use client";

import { useEffect, useState } from "react";
import { removePushSubscriptionAction, sendTestPushAction } from "@/server/actions/push";
import { buttonClasses } from "./button-classes";
import { detectPush, enablePush, type PushState } from "./push-client";

type State = "loading" | PushState;
type Notice = { tone: "ok" | "error"; text: string };

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
    detectPush()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setNotice(null);
    const result = await enablePush(publicKey);
    setBusy(false);
    if (result.ok) {
      setState("on");
      setNotice({ tone: "ok", text: "Notifications activées sur cet appareil." });
    } else if (result.state === "failed") {
      setNotice({ tone: "error", text: "L'activation a échoué. Réessayez dans un instant." });
    } else {
      setState(result.state);
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
