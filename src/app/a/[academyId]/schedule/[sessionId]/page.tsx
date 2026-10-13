import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatDateTime, localParts } from "@/domain/dates";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui/ui";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { ConfirmAction } from "@/components/ui/confirm";
import { InlineAction } from "@/components/ui/confirm";
import { cancelSessionAction, deleteSessionAction, reactivateSessionAction, updateSessionAction } from "@/server/actions/schedule";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getSession, listInstructors } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Modifier la séance" };

export default async function SessionPage({ params }: { params: Promise<{ academyId: string; sessionId: string }> }) {
  const { academyId, sessionId } = await params;
  const ctx = await requireAcademy(academyId, "schedule.manage");
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const data = await inAcademy(ctx, async (tx) => {
    const session = await getSession(tx, academyId, sessionId);
    return session ? { session, instructors: await listInstructors(tx, academyId) } : null;
  });
  if (!data) notFound();
  const { session, instructors } = data;
  const tz = ctx.academy.timezone;
  const start = localParts(session.startsAt, tz);
  const duration = Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000);

  return (
    <>
      <PageHeader
        title={session.classTypeName}
        description={
          <>
            {formatDateTime(session.startsAt, tz)} · {session.disciplineName} {session.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
          </>
        }
        actions={<Link href={`/a/${academyId}/schedule`}>← Planning</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title="Horaire et détails">
          <ActionForm action={updateSessionAction.bind(null, academyId, sessionId)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Date" name="date" type="date" defaultValue={start.date} required />
              <TextField label="Heure de début" name="time" type="time" defaultValue={start.time} required />
              <TextField label="Durée (minutes)" name="durationMinutes" type="number" defaultValue={duration} min={15} max={360} required />
            </div>
            <SelectField label="Coach" name="instructorId" defaultValue={session.instructorId ?? ""}>
              <option value="">Aucun coach assigné</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Capacité" name="capacity" type="number" min={1} max={500} defaultValue={session.capacity} className="max-w-xs" />
            <TextAreaField label="Note" name="notes" maxLength={500} defaultValue={session.notes} />
            <SubmitButton>Enregistrer</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Présences">
            <p className="mb-3 text-sm text-muted">
              {session.recorded} enregistrement(s), dont {session.attended} présent(s) ou en retard.
            </p>
            {session.status === "scheduled" && <LinkButton href={`/a/${academyId}/attendance/${sessionId}`}>Faire l&apos;appel</LinkButton>}
          </Card>
          <Card title="Annulation et suppression">
            <div className="flex flex-wrap items-start gap-2">
              {session.status === "scheduled" ? (
                <ConfirmAction
                  action={cancelSessionAction.bind(null, academyId, sessionId)}
                  trigger="Annuler la séance"
                  title="Annuler cette séance ?"
                  description={<p>Elle reste visible au planning, marquée « annulée ». Les présences déjà saisies sont conservées mais non modifiables.</p>}
                  confirmLabel="Annuler la séance"
                />
              ) : (
                <InlineAction action={reactivateSessionAction.bind(null, academyId, sessionId)} label="Réactiver" />
              )}
              {session.recorded === 0 ? (
                <ConfirmAction
                  action={deleteSessionAction.bind(null, academyId, sessionId)}
                  trigger="Supprimer"
                  title="Supprimer cette séance ?"
                  description={<p>Suppression définitive. Possible uniquement parce qu&apos;aucune présence n&apos;est enregistrée.</p>}
                  confirmLabel="Supprimer"
                />
              ) : (
                <p className="text-sm text-muted">Une séance avec des présences ne peut pas être supprimée : annulez-la.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
