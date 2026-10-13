"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/domain/errors";
import { buttonClasses, type ButtonVariant } from "./button-classes";
import { ActionForm, SubmitButton } from "./form";

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
        <span role="alert" className="text-sm text-red-800">
          {message.error}
        </span>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-ink shadow-xl"
        onClose={() => setMessage(null)}
      >
        <ActionForm
          action={action}
          className="space-y-4 p-6"
          onResult={(r) => {
            setMessage(r);
            if (r?.ok) dialog.current?.close();
          }}
        >
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="space-y-3 text-sm text-muted">{description}</div>
          {children}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
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
