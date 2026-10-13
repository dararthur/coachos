import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatDay, formatTime, localDate } from "@/domain/dates";
import { buttonClasses } from "@/components/ui/button-classes";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listSessions, type SessionRow } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Présences" };

function SessionList({ academyId, sessions, tz, mine }: { academyId: string; sessions: SessionRow[]; tz: string; mine: (s: SessionRow) => boolean }) {
  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="font-semibold">
              <span className="font-bold">{formatTime(s.startsAt, tz)}</span> · {s.classTypeName}
              <span className="ml-1.5 text-sm font-normal text-ink-soft">{formatDay(s.startsAt, tz)}</span>
            </p>
            <p className="text-sm text-ink-soft">
              {s.attended} présent{s.attended > 1 ? "s" : ""} · {s.recorded} enregistrement{s.recorded > 1 ? "s" : ""}
              {s.instructorName ? ` · ${s.instructorName}` : " · sans coach"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {s.status === "cancelled" ? <Badge tone="danger">Annulée</Badge> : s.recorded === 0 ? <Badge tone="warning">À faire</Badge> : <Badge tone="success">Fait</Badge>}
            {s.status === "scheduled" && (
              <Link href={`/a/${academyId}/attendance/${s.id}`} className={buttonClasses({ variant: "secondary" })}>
                {!mine(s) ? "Consulter" : s.recorded === 0 ? "Faire l'appel" : "Ouvrir l'appel"}
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
    // 14 jours : la même fenêtre que l'alerte « Présences à compléter » du tableau de bord, qui renvoie ici.
    recent: await listSessions(tx, academyId, tz, { from: addDays(today, -14), to: addDays(today, -1) }),
  }));
  const mine = (s: SessionRow) => ctx.role !== "coach" || s.instructorId === null || s.instructorId === ctx.user.id;

  return (
    <>
      <PageHeader title="Présences" description="Faites l'appel des séances du jour et complétez celles des jours précédents." />
      <div className="space-y-6">
        <Card title="Aujourd'hui" flush>
          {todays.length === 0 ? (
            <EmptyState level={3} title="Aucune séance aujourd'hui">
              Consultez le <Link href={`/a/${academyId}/schedule`}>planning</Link> pour une autre date.
            </EmptyState>
          ) : (
            <SessionList academyId={academyId} sessions={todays} tz={tz} mine={mine} />
          )}
        </Card>
        <Card title="14 derniers jours" flush description="Corrigez ou complétez les présences passées.">
          {recent.length === 0 ? <p className="px-4 py-5 text-sm text-ink-soft sm:px-5">Aucune séance sur la période.</p> : <SessionList academyId={academyId} sessions={[...recent].reverse()} tz={tz} mine={mine} />}
        </Card>
      </div>
    </>
  );
}
