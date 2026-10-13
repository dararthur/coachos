"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/domain/errors";
import { buttonClasses, type ButtonVariant } from "./button-classes";
import { ActionForm, SubmitButton } from "./form";
import { Icon } from "./icons";

type State = ActionResult<unknown> | null;

/**
 * Action sensible derrière une confirmation modale (élément <dialog> natif : focus piégé, Échap pour fermer).
 * Le contenu de `children` (champs de confirmation éventuels) est rendu dans le formulaire de la modale.
 */
export function ConfirmAction({
  action,
  trigger,
  title,
  description,
  confirmLabel,
  triggerVariant = "secondary",
  confirmVariant = "danger",
  children,
  triggerClassName,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  trigger: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  triggerVariant?: ButtonVariant;
  confirmVariant?: ButtonVariant;
  children?: ReactNode;
  triggerClassName?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [message, setMessage] = useState<State>(null);
  return (
    <>
      <button type="button" className={buttonClasses({ variant: triggerVariant, className: triggerClassName })} onClick={() => dialog.current?.showModal()}>
        {trigger}
      </button>
      {message && !message.ok && (
        <span role="alert" className="text-sm font-semibold text-danger">
          {message.error}
        </span>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-0 text-ink shadow-overlay"
        onClose={() => setMessage(null)}
      >
        <ActionForm
          action={action}
          className="space-y-4 p-5 sm:p-6"
          onResult={(r) => {
            setMessage(r);
            if (r?.ok) dialog.current?.close();
          }}
        >
          <h2 id={titleId} className="flex items-start gap-2.5 text-lg font-bold">
            {confirmVariant === "danger" && <Icon name="alert" size={22} className="text-danger" />}
            {title}
          </h2>
          <div className="space-y-3 text-sm text-ink-soft">{description}</div>
          {children}
          <div className="-mx-5 -mb-5 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6">
            <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={() => dialog.current?.close()}>
              Annuler
            </button>
            <SubmitButton variant={confirmVariant} pendingLabel="Traitement…">
              {confirmLabel}
            </SubmitButton>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}

/** Bouton d'action simple (sans modale) avec retour d'erreur visible. */
export function InlineAction({
  action,
  label,
  pendingLabel,
  variant = "secondary",
  hidden,
  className,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  hidden?: Record<string, string>;
  className?: string;
}) {
  return (
    <ActionForm action={action} className={className}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} pendingLabel={pendingLabel ?? "…"}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
