import { ActionForm, CheckboxField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import type { ActionResult } from "@/domain/errors";

type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown> | null>;

/** Formulaire de publication (création et modification). Aucune donnée de membre dans une publication : rappelé sous le texte. */
export function PostForm({ action, initial, submitLabel, notify = false }: { action: FormAction; initial?: { title: string; body: string }; submitLabel: string; notify?: boolean }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <TextField label="Titre" name="title" defaultValue={initial?.title} required maxLength={120} />
      <TextAreaField
        label="Texte"
        name="body"
        defaultValue={initial?.body}
        required
        rows={8}
        hint="Visible par tous les membres du club (5 000 caractères maximum). N'y mettez aucune information personnelle sur un membre (nom, santé, résultats)."
      />
      {notify && <CheckboxField label="Prévenir les membres par notification" name="notify" defaultChecked hint="Seuls les membres qui ont activé les notifications sur leur appareil la reçoivent." />}
      <SubmitButton pendingLabel="Publication…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
