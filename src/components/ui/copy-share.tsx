"use client";

import { useState, useSyncExternalStore } from "react";
import { buttonClasses } from "./button-classes";
import { Icon } from "./icons";

const noop = () => () => {};

/**
 * « Copier » (avec confirmation visible) et, là où le navigateur sait le faire (téléphones), « Partager » : la feuille de partage
 * du système ouvre WhatsApp, SMS ou e-mail. Remplace la sélection à la main d'un lien dans un champ, pénible sur téléphone.
 */
export function CopyShare({ text, shareTitle, shareText, className }: { text: string; shareTitle: string; shareText?: string; className?: string }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 4000);
  }

  async function share() {
    try {
      await navigator.share({ title: shareTitle, text: shareText ? `${shareText} ${text}` : text });
    } catch {
      // Partage annulé par l'utilisateur : rien à signaler.
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {canShare && (
        <button type="button" onClick={share} className={buttonClasses({ variant: "primary" })}>
          <Icon name="share" size={18} />
          Partager
        </button>
      )}
      <button type="button" onClick={copy} className={buttonClasses({ variant: "secondary" })}>
        <Icon name={copied === "ok" ? "check" : "copy"} size={18} />
        {copied === "ok" ? "Lien copié" : "Copier le lien"}
      </button>
      <span role="status" className="text-sm">
        {copied === "failed" ? "Copie impossible : sélectionnez le lien et copiez-le à la main." : ""}
      </span>
    </div>
  );
}
