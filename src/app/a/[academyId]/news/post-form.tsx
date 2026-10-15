import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import type { ActionResult } from "@/domain/errors";

type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown> | null>;

/** Formulaire de publication (création et modification). Aucune donnée de membre dans une publication : rappelé sous le texte. */
export function PostForm({ action, initial, submitLabel }: { action: FormAction; initial?: { title: string; body: string }; submitLabel: string }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <TextField label="Titre" name="title" defaultValue={initial?.title} required maxLength={120} />
      <TextAreaField
        label="Texte"
        name="body"
        defaultValue={initial?.body}
        required
        maxLength={5000}
        rows={8}
        hint="Visible par tous les membres du club. N'y mettez aucune information personnelle sur un membre (nom, santé, résultats)."
      />
      <SubmitButton pendingLabel="Publication…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
