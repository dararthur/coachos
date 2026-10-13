import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatDay, formatTime, localDate } from "@/domain/dates";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listSessions, type SessionRow } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Présences" };

function SessionList({ academyId, sessions, tz, mine }: { academyId: string; sessions: SessionRow[]; tz: string; mine: (s: SessionRow) => boolean }) {
  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="font-medium">
              {formatDay(s.startsAt, tz)} · {formatTime(s.startsAt, tz)} · {s.classTypeName}
            </p>
            <p className="text-sm text-muted">
              {s.attended} présent{s.attended > 1 ? "s" : ""} · {s.recorded} enregistrement{s.recorded > 1 ? "s" : ""}
              {s.instructorName ? ` · ${s.instructorName}` : " · sans coach"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {s.status === "cancelled" ? <Badge tone="danger">Annulée</Badge> : s.recorded === 0 ? <Badge tone="warning">À faire</Badge> : <Badge tone="success">Fait</Badge>}
            {s.status === "scheduled" && (
              <Link href={`/a/${academyId}/attendance/${s.id}`} className="inline-flex min-h-11 items-center px-2 text-sm font-medium">
                {mine(s) ? "Faire l'appel" : "Consulter"}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function AttendancePage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId, "attendance.record");
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);
  const { todays, recent } = await inAcademy(ctx, async (tx) => ({
    todays: await listSessions(tx, academyId, tz, { from: today, to: today }),
    recent: await listSessions(tx, academyId, tz, { from: addDays(today, -7), to: addDays(today, -1) }),
  }));
  const mine = (s: SessionRow) => ctx.role !== "coach" || s.instructorId === null || s.instructorId === ctx.user.id;

  return (
    <>
      <PageHeader title="Présences" description="Faites l'appel des séances du jour et complétez celles des jours précédents." />
      <div className="space-y-6">
        <Card title="Aujourd'hui">
          {todays.length === 0 ? (
            <EmptyState title="Aucune séance aujourd'hui">
              Consultez le <Link href={`/a/${academyId}/schedule`}>planning</Link> pour une autre date.
            </EmptyState>
          ) : (
            <SessionList academyId={academyId} sessions={todays} tz={tz} mine={mine} />
          )}
        </Card>
        <Card title="7 derniers jours" description="Corrigez ou complétez les présences passées.">
          {recent.length === 0 ? <p className="text-sm text-muted">Aucune séance sur la période.</p> : <SessionList academyId={academyId} sessions={[...recent].reverse()} tz={tz} mine={mine} />}
        </Card>
      </div>
    </>
  );
}
