"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonClasses } from "./button-classes";
import { Icon } from "./icons";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "standalone" | "ios" | "installable" | "other";

const DISMISS_KEY = "matnexa-install-dismissed";

const subscribeNothing = () => () => {};

/** Plateforme lue côté navigateur uniquement (le serveur rend « other », sans clignotement : rien n'est affiché avant l'hydratation). */
function detectPlatform(): Platform {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) return "standalone";
  const ua = nav.userAgent;
  const iPadOs = /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  return "other";
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Installation de Matnexa sur l'écran d'accueil. Android/Chrome : bouton qui déclenche l'invite du navigateur. iPhone/iPad : mode d'emploi
 * (Safari n'a pas d'invite programmable). Déjà installée : rien. `banner` : bandeau discret et refermable (mémorisé sur l'appareil) ;
 * sinon, bloc permanent pour la page « Mon compte ».
 */
export function InstallApp({ banner = false }: { banner?: boolean }) {
  const base = useSyncExternalStore(subscribeNothing, detectPlatform, () => "other" as Platform);
  const startedDismissed = useSyncExternalStore(subscribeNothing, readDismissed, () => true);
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const platform: Platform = installed ? "standalone" : event ? "installable" : base;
  if (banner && (startedDismissed || dismissed)) return null;
  if (platform === "standalone") return banner ? null : <p className="text-sm text-ink-soft">Matnexa est déjà installée sur cet appareil.</p>;
  if (banner && platform === "other") return null;

  function close() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* stockage indisponible : le bandeau reviendra, sans conséquence */
    }
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setEvent(null);
  }

  const body =
    platform === "installable" ? (
      <button type="button" className={buttonClasses({ variant: banner ? "secondary" : "primary" })} onClick={install}>
        Installer l&apos;application
      </button>
    ) : platform === "ios" ? (
      <p className="text-sm">
        Touchez le bouton <strong>Partager</strong> <Icon name="upload" size={16} className="inline-block align-text-bottom" /> de Safari, puis <strong>« Sur l&apos;écran d&apos;accueil »</strong>.
      </p>
    ) : (
      <p className="text-sm text-ink-soft">Ouvrez Matnexa depuis le navigateur de votre téléphone (Chrome ou Safari) pour l&apos;installer sur l&apos;écran d&apos;accueil.</p>
    );

  if (!banner) return <div className="space-y-3">{body}</div>;

  return (
    <aside aria-label="Installer l'application" className="mb-4 flex items-start gap-3 rounded-sm border border-line bg-surface px-4 py-3 print:hidden">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-bold">Matnexa sur votre écran d&apos;accueil</p>
        <p className="text-sm text-ink-soft">Ouverture en un geste, plein écran, et vous restez connecté.</p>
        {body}
      </div>
      <button type="button" onClick={close} className="-mr-2 -mt-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-ink-soft hover:bg-sunken" aria-label="Masquer ce message">
        <Icon name="x" size={18} />
      </button>
    </aside>
  );
}
