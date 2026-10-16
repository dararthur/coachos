import type { Metadata } from "next";
import { localDate } from "@/domain/dates";
import { WEEKDAY_LABELS } from "@/domain/schedule";
import { Card, EmptyState, LinkButton, PageHeader, BackLink } from "@/components/ui/ui";
import { ActionForm, CheckboxGroup, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { createSessionsAction } from "@/server/actions/schedule";
import { RecurrenceEnd } from "./recurrence-end";
import { SessionFields } from "./session-fields";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listClassTypes } from "@/server/repositories/academies";
import { listInstructors } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Nouvelle séance" };

export default async function NewSessionPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId, "schedule.manage");
  const { types, instructors } = await inAcademy(ctx, async (tx) => ({
    types: await listClassTypes(tx, academyId),
    instructors: await listInstructors(tx, academyId),
  }));
  const today = localDate(new Date(), ctx.academy.timezone);

  return (
    <>
      <PageHeader title="Nouvelle séance" description="Une séance unique, ou une récurrence hebdomadaire créée en une fois." back={<BackLink href={`/a/${academyId}/schedule`}>Planning</BackLink>} />
      {types.length === 0 ? (
        <EmptyState title="Aucun type de cours" action={<LinkButton href={`/a/${academyId}/settings`}>Configurer les cours</LinkButton>}>
          Créez d&apos;abord un type de cours (par exemple « JJB — Tous niveaux ») dans les paramètres.
        </EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <ActionForm action={createSessionsAction.bind(null, academyId)} className="space-y-5">
            <SessionFields types={types.map((t) => ({ id: t.id, label: `${t.disciplineName} — ${t.name} (${t.durationMinutes} min)`, durationMinutes: t.durationMinutes }))} instructors={instructors} today={today} />
            <TextField label="Nombre de places" name="capacity" type="number" inputMode="numeric" min={1} max={500} hint="Facultatif. Au-delà, les réservations passent en liste d'attente." className="max-w-xs" />

            {/* Jours et date de fin n'apparaissent qu'en répétition hebdomadaire (CSS :has ; sans support, tout reste visible). */}
            <fieldset className="space-y-4 rounded-sm border border-line bg-canvas p-4 [&:has(option[value=none]:checked)_[data-repeat]]:hidden">
              <legend className="px-1 text-sm font-semibold">Répétition</legend>
              <SelectField label="Fréquence" name="repeat" defaultValue="none">
                <option value="none">Séance unique</option>
                <option value="weekly">Toutes les semaines</option>
              </SelectField>
              <div data-repeat className="space-y-4">
                <CheckboxGroup legend="Jours" name="weekdays" options={Object.entries(WEEKDAY_LABELS).map(([value, label]) => ({ value, label }))} />
                <RecurrenceEnd firstDate={today} />
              </div>
            </fieldset>

            <TextAreaField label="Note" name="notes" maxLength={500} hint="Facultatif (ex. « apportez votre gi »)." />
            <SubmitButton pendingLabel="Création…">Créer la séance</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
