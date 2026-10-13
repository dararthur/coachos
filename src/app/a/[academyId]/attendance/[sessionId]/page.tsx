import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatDateTime, formatTime } from "@/domain/dates";
import { Alert, Badge, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getRoster } from "@/server/repositories/attendance";
import { getSession } from "@/server/repositories/schedule";
import { Roster } from "./roster";

export const metadata: Metadata = { title: "Appel" };

export default async function RosterPage({ params }: { params: Promise<{ academyId: string; sessionId: string }> }) {
  const { academyId, sessionId } = await params;
  const ctx = await requireAcademy(academyId, "attendance.record");
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const data = await inAcademy(ctx, async (tx) => {
    const session = await getSession(tx, academyId, sessionId);
    return session ? { session, roster: await getRoster(tx, academyId, sessionId) } : null;
  });
  if (!data) notFound();
  const { session, roster } = data;
  const tz = ctx.academy.timezone;
  const allowed = ctx.role !== "coach" || session.instructorId === null || session.instructorId === ctx.user.id;
  const editable = allowed && session.status === "scheduled";

  return (
    <>
      <PageHeader
        title={session.classTypeName}
        description={
          <>
            {formatDateTime(session.startsAt, tz)}–{formatTime(session.endsAt, tz)} · {session.disciplineName}
            {session.instructorName ? ` · ${session.instructorName}` : ""} {session.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
          </>
        }
        actions={<Link href={`/a/${academyId}/attendance`}>← Présences</Link>}
      />
      {session.status === "cancelled" && <Alert tone="warning">Cette séance est annulée : les présences ne sont plus modifiables.</Alert>}
      {!allowed && session.status === "scheduled" && <Alert tone="info">Cette séance est affectée à un autre coach : vous pouvez la consulter mais pas modifier les présences.</Alert>}
      <Roster academyId={academyId} sessionId={sessionId} initial={roster} editable={editable} capacity={session.capacity} />
    </>
  );
}
