import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatDay, formatTime, localDate, mondayOf, parseCalendarDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listSessions } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Planning" };

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { academyId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId, "schedule.read");
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);
  const requested = typeof sp.week === "string" ? parseCalendarDate(sp.week) : null;
  const monday = mondayOf(requested ?? today);
  const sunday = addDays(monday, 6);

  const sessions = await inAcademy(ctx, (tx) => listSessions(tx, academyId, tz, { from: monday, to: sunday }));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = localDate(s.startsAt, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const canManage = can(ctx.role, "schedule.manage");
  const canRecord = can(ctx.role, "attendance.record");
  const fmt = (d: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${d}T00:00:00Z`));

  return (
    <>
      <PageHeader title="Planning" description={`Semaine du ${fmt(monday)} au ${fmt(sunday)}.`} actions={canManage ? <LinkButton href={`/a/${academyId}/schedule/new`}>Nouvelle séance</LinkButton> : undefined} />
      <Notice searchParams={sp} />

      <nav aria-label="Navigation par semaine" className="mb-4 flex flex-wrap gap-2">
        <Link className="rounded-lg bg-white px-3 py-2 text-sm font-medium no-underline ring-1 ring-slate-300 hover:bg-slate-50" href={`/a/${academyId}/schedule?week=${addDays(monday, -7)}`}>
          ← Semaine précédente
        </Link>
        <Link className="rounded-lg bg-white px-3 py-2 text-sm font-medium no-underline ring-1 ring-slate-300 hover:bg-slate-50" href={`/a/${academyId}/schedule`}>
          Cette semaine
        </Link>
        <Link className="rounded-lg bg-white px-3 py-2 text-sm font-medium no-underline ring-1 ring-slate-300 hover:bg-slate-50" href={`/a/${academyId}/schedule?week=${addDays(monday, 7)}`}>
          Semaine suivante →
        </Link>
      </nav>

      {sessions.length === 0 && (
        <EmptyState title="Aucune séance cette semaine" action={canManage ? <LinkButton href={`/a/${academyId}/schedule/new`}>Planifier des séances</LinkButton> : undefined}>
          {canManage ? "Créez une séance unique ou une récurrence hebdomadaire (jusqu'à 6 mois)." : "Le planning de ce club n'a pas encore de séance pour cette semaine."}
        </EmptyState>
      )}

      <div className="space-y-4">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          if (list.length === 0) return null;
          return (
            <Card key={day} title={`${formatDay(new Date(`${day}T12:00:00Z`), "UTC")}${day === today ? " — aujourd'hui" : ""}`}>
              <ul className="divide-y divide-line">
                {list.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className={`font-medium ${s.status === "cancelled" ? "text-muted line-through" : ""}`}>
                        {formatTime(s.startsAt, tz)}–{formatTime(s.endsAt, tz)} · {s.classTypeName}
                      </p>
                      <p className="text-sm text-muted">
                        {s.disciplineName}
                        {s.instructorName ? ` · ${s.instructorName}` : ""}
                        {s.capacity ? ` · ${s.attended}/${s.capacity} places` : s.attended ? ` · ${s.attended} présent(s)` : ""}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {s.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
                      {s.status === "scheduled" && canRecord && (
                        <Link href={`/a/${academyId}/attendance/${s.id}`} className="text-sm font-medium">
                          Appel
                        </Link>
                      )}
                      {canManage && (
                        <Link href={`/a/${academyId}/schedule/${s.id}`} className="text-sm font-medium">
                          Modifier
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
