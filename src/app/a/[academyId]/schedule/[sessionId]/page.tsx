import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatDateTime, localParts } from "@/domain/dates";
import { Badge, Card, LinkButton, PageHeader, BackLink } from "@/components/ui/ui";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { ConfirmAction } from "@/components/ui/confirm";
import { InlineAction } from "@/components/ui/confirm";
import { cancelSessionAction, deleteSessionAction, reactivateSessionAction, updateSessionAction } from "@/server/actions/schedule";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getSession, listInstructors, memberBookings, seriesInfo, type SeriesInfo } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Modifier la séance" };

const plural = (n: number) => `${n} séance${n > 1 ? "s" : ""}`;

/**
 * Portée d'une modification ou d'une suppression, proposée seulement pour une séance d'une série qui compte d'autres séances à venir.
 * Les séances déjà commencées ne sont jamais touchées par une opération de série.
 */
function ScopeChoice({ series, action }: { series: SeriesInfo; action: "edit" | "delete" }) {
  if (!series.seriesId || series.upcoming < 2) return null;
  const options = [
    { value: "this", label: "Cette séance seulement" },
    ...(series.following > 1 && series.following < series.upcoming ? [{ value: "following", label: `Cette séance et les suivantes de la série (${plural(series.following)})` }] : []),
    { value: "upcoming", label: `Toutes les séances à venir de la série (${plural(series.upcoming)})` },
  ];
  return (
    <fieldset className="space-y-1 rounded-sm border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{action === "edit" ? "Appliquer à" : "Supprimer"}</legend>
      {options.map((o, i) => (
        <label key={o.value} className="flex min-h-11 items-center gap-3 text-sm">
          <input type="radio" name="scope" value={o.value} defaultChecked={i === 0} className="size-5 shrink-0 accent-ink" />
          {o.label}
        </label>
      ))}
      {action === "edit" && <p className="text-sm text-ink-soft">Pour plusieurs séances, chacune garde son jour : l&apos;heure, la durée, le coach, les places et la note changent ; la date saisie ne vaut que pour cette séance seule.</p>}
    </fieldset>
  );
}

export default async function SessionPage({ params }: { params: Promise<{ academyId: string; sessionId: string }> }) {
  const { academyId, sessionId } = await params;
  const ctx = await requireAcademy(academyId, "schedule.manage");
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const data = await inAcademy(ctx, async (tx) => {
    const session = await getSession(tx, academyId, sessionId);
    return session
      ? { session, instructors: await listInstructors(tx, academyId), series: await seriesInfo(tx, academyId, sessionId), booked: await memberBookings(tx, academyId, sessionId) }
      : null;
  });
  if (!data) notFound();
  const { session, instructors, series, booked } = data;
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
        back={<BackLink href={`/a/${academyId}/schedule`}>Planning</BackLink>}
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
            <TextField label="Nombre de places" name="capacity" type="number" inputMode="numeric" min={1} max={500} defaultValue={session.capacity} hint="Facultatif. Au-delà, les réservations passent en liste d'attente." className="max-w-xs" />
            <TextAreaField label="Note" name="notes" maxLength={500} defaultValue={session.notes} />
            <ScopeChoice series={series} action="edit" />
            <SubmitButton>Enregistrer</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Présences">
            <p className="mb-3 text-sm text-ink-soft">
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
              {session.recorded === 0 || series.upcoming > 1 ? (
                <ConfirmAction
                  action={deleteSessionAction.bind(null, academyId, sessionId)}
                  trigger={series.seriesId && series.upcoming > 1 ? "Supprimer…" : "Supprimer"}
                  title={series.seriesId && series.upcoming > 1 ? "Supprimer des séances de la série ?" : "Supprimer cette séance ?"}
                  description={
                    <>
                      <p>Suppression définitive. Une séance qui a des inscrits n&apos;est pas supprimée : elle est <strong>annulée</strong> et ses inscrits sont prévenus par e-mail. Une séance avec des présences reste au planning.</p>
                      {booked > 0 && <p className="mt-2 font-semibold">Cette séance a {booked} inscrit{booked > 1 ? "s" : ""} : elle sera annulée, pas supprimée.</p>}
                    </>
                  }
                  confirmLabel="Supprimer"
                >
                  <ScopeChoice series={series} action="delete" />
                </ConfirmAction>
              ) : (
                <p className="text-sm text-ink-soft">Une séance avec des présences ne peut pas être supprimée : annulez-la.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
