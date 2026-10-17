import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatDateTime, formatTime, localDate } from "@/domain/dates";
import { Alert, BackLink, Badge, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getRoster } from "@/server/repositories/attendance";
import { getCheckinSettings, getCheckinState, serverNow } from "@/server/repositories/checkin";
import { getSession } from "@/server/repositories/schedule";
import { Roster } from "./roster";

export const metadata: Metadata = { title: "Appel" };

export default async function RosterPage({ params }: { params: Promise<{ academyId: string; sessionId: string }> }) {
  const { academyId, sessionId } = await params;
  const ctx = await requireAcademy(academyId, "attendance.record");
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const data = await inAcademy(ctx, async (tx) => {
    const session = await getSession(tx, academyId, sessionId);
    if (!session) return null;
    const checkin = await getCheckinState(tx, academyId, sessionId);
    return { session, roster: await getRoster(tx, academyId, sessionId), checkin, checkinSettings: await getCheckinSettings(tx, academyId), serverNow: serverNow() };
  });
  if (!data) notFound();
  const { session, roster, checkin, checkinSettings, serverNow: now } = data;
  const tz = ctx.academy.timezone;
  const allowed = ctx.role !== "coach" || session.instructorId === null || session.instructorId === ctx.user.id;
  const editable = allowed && session.status === "scheduled";
  // Cours d'un jour à venir : la liste (inscrits, liste d'attente) se gère déjà, l'appel attend le jour du cours (refusé aussi par le serveur).
  const upcoming = localDate(session.startsAt, tz) > localDate(new Date(now), tz);

  return (
    <>
      <PageHeader
        title={session.classTypeName}
        back={<BackLink href={`/a/${academyId}/attendance`}>Présences</BackLink>}
        description={
          <>
            <span>
              {formatDateTime(session.startsAt, tz)}–{formatTime(session.endsAt, tz)} · {session.disciplineName}
              {session.instructorName ? ` · ${session.instructorName}` : ""}
            </span>
            {session.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
          </>
        }
      />
      {session.status === "cancelled" && <Alert tone="warning">Cette séance est annulée : les présences ne sont plus modifiables et le pointage est impossible.</Alert>}
      {editable && upcoming && <Alert tone="info">Cours à venir : l&apos;appel sera possible le jour du cours. Vous pouvez déjà accorder des places aux personnes en liste d&apos;attente.</Alert>}
      {!allowed && session.status === "scheduled" && <Alert tone="info">Cette séance est affectée à un autre coach : vous pouvez la consulter mais pas modifier les présences.</Alert>}
      <Roster
        academyId={academyId}
        sessionId={sessionId}
        initial={{
          entries: roster,
          serverNow: now,
          checkin: { status: checkin.status, windowEndsAt: checkin.windowEndsAt?.getTime() ?? null, validatedAt: checkin.validatedAt?.getTime() ?? null, validatedAuto: checkin.validatedAuto },
        }}
        editable={editable}
        upcoming={upcoming}
        startsAt={session.startsAt.getTime()}
        capacity={session.capacity}
        qrAllowed={editable}
        fixedQr={checkinSettings.mode === "fixed" ? { before: checkinSettings.beforeMinutes, after: checkinSettings.afterMinutes } : null}
      />
    </>
  );
}
