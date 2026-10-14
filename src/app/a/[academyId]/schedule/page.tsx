import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatDay, formatTime, localDate, mondayOf, parseCalendarDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import { buttonClasses } from "@/components/ui/button-classes";
import { Icon } from "@/components/ui/icons";
import { Badge, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui/ui";
import { BookingControls, occupancyLabel } from "@/components/ui/booking";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { attachBookings } from "@/server/repositories/bookings";
import { listSessions } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Planning" };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { academyId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId, "schedule.read");
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);
  const requested = typeof sp.week === "string" ? parseCalendarDate(sp.week) : null;
  const monday = mondayOf(requested ?? today);
  const sunday = addDays(monday, 6);

  const now = new Date();
  const sessions = await inAcademy(ctx, async (tx) => attachBookings(tx, academyId, await listSessions(tx, academyId, tz, { from: monday, to: sunday })));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = localDate(s.startsAt, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const canManage = can(ctx.role, "schedule.manage");
  const canRecord = can(ctx.role, "attendance.record");
  const isMember = ctx.role === "member";
  const fmt = (d: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${d}T00:00:00Z`));

  return (
    <>
      <PageHeader title="Planning" description={`Semaine du ${fmt(monday)} au ${fmt(sunday)}.`} actions={canManage ? <LinkButton href={`/a/${academyId}/schedule/new`}>Nouvelle séance</LinkButton> : undefined} />
      <Notice searchParams={sp} />

      <nav aria-label="Navigation par semaine" className="mb-4 inline-flex rounded-sm border border-line-strong bg-surface p-0.5">
        <Link className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3 text-sm font-semibold no-underline hover:bg-sunken" href={`/a/${academyId}/schedule?week=${addDays(monday, -7)}`}>
          <Icon name="prev" size={18} />
          <span className="sr-only sm:not-sr-only">Semaine précédente</span>
        </Link>
        <Link className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3 text-sm font-semibold no-underline hover:bg-sunken" href={`/a/${academyId}/schedule`}>
          Cette semaine
        </Link>
        <Link className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3 text-sm font-semibold no-underline hover:bg-sunken" href={`/a/${academyId}/schedule?week=${addDays(monday, 7)}`}>
          <span className="sr-only sm:not-sr-only">Semaine suivante</span>
          <Icon name="next" size={18} />
        </Link>
      </nav>

      {sessions.length === 0 && (
        <EmptyState framed title="Aucune séance cette semaine" action={canManage ? <LinkButton href={`/a/${academyId}/schedule/new`}>Planifier des séances</LinkButton> : undefined}>
          {canManage ? "Créez une séance unique ou une récurrence hebdomadaire (jusqu’à la fin de l’année)." : "Le planning de ce club n'a pas encore de séance pour cette semaine."}
        </EmptyState>
      )}

      <div className={sessions.length ? "overflow-hidden rounded-sm border border-line bg-surface" : ""}>
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          if (list.length === 0) return null;
          const isToday = day === today;
          return (
            <section key={day} className="border-t border-line first:border-t-0">
              <h2 className={`flex items-center gap-2 px-4 py-2 text-sm font-bold sm:px-5 ${isToday ? "bg-ink text-white" : "bg-sunken"}`}>
                {capitalize(formatDay(new Date(`${day}T12:00:00Z`), "UTC"))}
                {isToday && <span className="text-xs font-semibold text-bar-muted">aujourd&apos;hui</span>}
              </h2>
              <ul className="divide-y divide-line">
                {list.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                    <p className="w-14 shrink-0 text-lg font-bold font-stretch-[80%] leading-none">
                      {formatTime(s.startsAt, tz)}
                      <span className="mt-1 block text-xs font-medium font-stretch-100% text-ink-soft">{formatTime(s.endsAt, tz)}</span>
                    </p>
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold ${s.status === "cancelled" ? "text-ink-soft line-through" : ""}`}>{s.classTypeName}</p>
                      <p className="text-sm text-ink-soft">
                        {s.disciplineName}
                        {s.instructorName ? ` · ${s.instructorName}` : ""}
                        {s.status === "scheduled" && s.endsAt > now
                          ? ` · ${occupancyLabel(s, s.capacity)}`
                          : s.attended
                            ? ` · ${s.attended} présent(s)`
                            : ""}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                      {s.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
                      {isMember && s.status === "scheduled" && <BookingControls academyId={academyId} sessionId={s.id} myStatus={s.myStatus} myPosition={s.myPosition} bookable={s.endsAt > now} />}
                      {s.status === "scheduled" && canRecord && (
                        <Link href={`/a/${academyId}/attendance/${s.id}`} className={buttonClasses({ variant: "secondary" })}>
                          Appel
                        </Link>
                      )}
                      {canManage && (
                        <Link href={`/a/${academyId}/schedule/${s.id}`} className={buttonClasses({ variant: "quiet" })}>
                          Modifier
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
