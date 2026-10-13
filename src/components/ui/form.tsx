"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/domain/errors";
import { buttonClasses, type ButtonVariant } from "./button-classes";

type State = ActionResult<unknown> | null;
type FormAction<S extends State> = (prev: S, formData: FormData) => Promise<S>;

interface Held<S extends State> {
  result: S;
  values: Record<string, string>;
}

const FormContext = createContext<{ result: State; values: Record<string, string> }>({ result: null, values: {} });

/**
 * Formulaire branché sur une Server Action (useActionState). Garde les valeurs saisies après une erreur
 * (sauf mots de passe), affiche le résultat dans une région vivante et relie les erreurs aux champs.
 */
export function ActionForm<S extends State>({
  action,
  children,
  className,
  resetOnSuccess = false,
  hideMessage = false,
  encType,
  onResult,
}: {
  action: FormAction<S>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hideMessage?: boolean;
  encType?: "multipart/form-data";
  onResult?: (result: S) => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [held, formAction] = useActionState(
    async (_prev: Held<S> | null, formData: FormData): Promise<Held<S>> => {
      const values: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string" && !key.startsWith("$ACTION") && !/pass|confirm/i.test(key)) values[key] = value;
      }
      const result = await action(null as S, formData);
      return { result, values };
    },
    null,
  );
  const result = held?.result ?? null;

  useEffect(() => {
    if (result) onResult?.(result);
    if (result?.ok && resetOnSuccess) ref.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  return (
    <form ref={ref} action={formAction} className={className} encType={encType} noValidate={false}>
      <FormContext.Provider value={{ result, values: result && !result.ok ? (held?.values ?? {}) : {} }}>
        {!hideMessage && <FormMessage result={result} />}
        {children}
      </FormContext.Provider>
    </form>
  );
}

export function FormMessage({ result }: { result: State }) {
  // Région vivante toujours présente : les lecteurs d'écran annoncent le contenu quand il change.
  const failed = result && !result.ok;
  const hasFieldErrors = failed && result.fieldErrors && Object.keys(result.fieldErrors).length > 0;
  return (
    <div role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} className="empty:hidden">
      {failed && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {hasFieldErrors && result.code === "validation" ? "Certaines informations sont invalides : corrigez les champs signalés." : result.error}
        </p>
      )}
      {result?.ok && result.message && (
        <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{result.message}</p>
      )}
    </div>
  );
}

function useFieldState(name: string) {
  const ctx = useContext(FormContext);
  const error = ctx.result && !ctx.result.ok ? ctx.result.fieldErrors?.[name] : undefined;
  return { error, retained: ctx.values[name] };
}

const inputClasses =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink shadow-sm placeholder:text-slate-500 disabled:bg-slate-100 aria-[invalid=true]:border-red-600";

interface BaseFieldProps {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  className?: string;
}

function FieldShell({ label, name, hint, required, id, error, className, children }: BaseFieldProps & { id: string; error?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-red-700">
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-800" data-field-error={name}>
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

export function TextField({
  label, name, hint, required, className, type = "text", defaultValue, ...rest
}: BaseFieldProps & { type?: string; defaultValue?: string | number | null } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type" | "defaultValue" | "className">) {
  const id = useId();
  const { error, retained } = useFieldState(name);
  const secret = type === "password";
  return (
    <FieldShell {...{ label, name, hint, required, id, error, className }}>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={secret ? undefined : (retained ?? defaultValue ?? "")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClasses}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label, name, hint, required, className, defaultValue, children, ...rest
}: BaseFieldProps & { defaultValue?: string; children: ReactNode } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name" | "defaultValue" | "className">) {
  const id = useId();
  const { error, retained } = useFieldState(name);
  return (
    <FieldShell {...{ label, name, hint, required, id, error, className }}>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={retained ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClasses}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label, name, hint, required, className, defaultValue, ...rest
}: BaseFieldProps & { defaultValue?: string | null } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "defaultValue" | "className">) {
  const id = useId();
  const { error, retained } = useFieldState(name);
  return (
    <FieldShell {...{ label, name, hint, required, id, error, className }}>
      <textarea
        id={id}
        name={name}
        required={required}
        defaultValue={retained ?? defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClasses}
        rows={3}
        {...rest}
      />
    </FieldShell>
  );
}

export function CheckboxField({ label, name, hint, required, className, defaultChecked, value = "on" }: BaseFieldProps & { defaultChecked?: boolean; value?: string }) {
  const id = useId();
  const { error, retained } = useFieldState(name);
  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          value={value}
          required={required}
          defaultChecked={retained !== undefined ? retained === value : defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className="mt-1 size-5 shrink-0 rounded border-slate-400 accent-brand-600"
        />
        <label htmlFor={id} className="text-sm text-ink">
          {label}
          {hint && (
            <span id={`${id}-hint`} className="mt-0.5 block text-muted">
              {hint}
            </span>
          )}
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-800" data-field-error={name}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Groupe de cases à cocher (ex. jours de la semaine). */
export function CheckboxGroup({ legend, name, options, error, defaultValues = [] }: { legend: string; name: string; options: { value: string; label: string }[]; error?: string; defaultValues?: string[] }) {
  const ctx = useContext(FormContext);
  const fieldError = error ?? (ctx.result && !ctx.result.ok ? ctx.result.fieldErrors?.[name] : undefined);
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="size-4 accent-brand-600" />
            {o.label}
          </label>
        ))}
      </div>
      {fieldError && (
        <p className="mt-1 text-sm font-medium text-red-800" data-field-error={name}>
          {fieldError}
        </p>
      )}
    </fieldset>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={buttonClasses({ variant, className })}>
      {pending ? pendingLabel : children}
    </button>
  );
}
