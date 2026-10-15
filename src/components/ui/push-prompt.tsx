"use client";

import { useEffect, useState } from "react";
import { buttonClasses } from "./button-classes";
import { detectPush, enablePush, isStandalone } from "./push-client";

const DISMISS_KEY = "matnexa-push-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Proposition d'activer les notifications au premier lancement de l'application INSTALLÉE (écran d'accueil), moment où la
 * demande est la plus naturelle — et le seul possible sur iPhone. Jamais dans un onglet de navigateur, jamais si le choix est
 * déjà fait (accepté ou refusé), jamais après « Plus tard » (mémorisé sur l'appareil ; « Mon compte » reste disponible).
 * La permission n'est demandée qu'au toucher du bouton.
 */
export function PushPrompt({ publicKey }: { publicKey: string }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isStandalone() || readDismissed()) return;
    let alive = true;
    detectPush()
      .then((state) => alive && state === "off" && Notification.permission === "default" && setVisible(true))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function later() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* stockage indisponible : la proposition reviendra, sans conséquence */
    }
  }

  async function enable() {
    setBusy(true);
    const result = await enablePush(publicKey);
    setBusy(false);
    if (result.ok) setDone(true);
    else later(); // refus ou échec : on ne redemande pas ; « Mon compte » permet de réessayer
  }

  if (done) {
    return (
      <p role="status" className="mb-4 rounded-sm border border-line bg-surface px-4 py-3 text-sm font-semibold print:hidden">
        Notifications activées sur cet appareil.
      </p>
    );
  }
  if (!visible) return null;

  return (
    <aside aria-label="Activer les notifications" className="mb-4 space-y-2 rounded-sm border border-line bg-surface px-4 py-3 print:hidden">
      <p className="text-sm font-bold">Être prévenu des annonces du club ?</p>
      <p className="text-sm text-ink-soft">Recevez les actualités sur cet appareil, même quand l&apos;application est fermée. Modifiable à tout moment dans « Mon compte ».</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={enable} disabled={busy} className={buttonClasses({ variant: "primary" })}>
          {busy ? "Activation…" : "Activer les notifications"}
        </button>
        <button type="button" onClick={later} disabled={busy} className={buttonClasses({ variant: "quiet" })}>
          Plus tard
        </button>
      </div>
    </aside>
  );
}
