import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatDateTime, formatDay, formatTime, localDate, mondayOf, parseCalendarDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import type { AttendanceStatus } from "@/domain/validation";
import { viewingAsMember } from "@/server/view-mode";
import { buttonClasses } from "@/components/ui/button-classes";
import { Icon } from "@/components/ui/icons";
import { Badge, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui/ui";
import { BookingControls, occupancyLabel, WAITLIST_HINT } from "@/components/ui/booking";
import { AttendanceBadge } from "@/components/ui/attendance-history";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { personAttendanceFor } from "@/server/repositories/attendance";
import { attachBookings } from "@/server/repositories/bookings";
import { getMyProfile } from "@/server/repositories/profile";
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
  // Mode membre de l'équipe : la page est celle d'un adhérent (réserver), sans les commandes de gestion.
  const asMember = await viewingAsMember(ctx.role);
  const isMember = ctx.role === "member" || asMember;
  const { sessions, myAttendance } = await inAcademy(ctx, async (tx) => {
    const sessions = await attachBookings(tx, academyId, await listSessions(tx, academyId, tz, { from: monday, to: sunday }));
    // L'adhérent voit le résultat de l'appel sur les séances passées (Présent / En retard / Absent) plutôt que sa seule réservation.
    const me = isMember ? await getMyProfile(tx, academyId) : null;
    const myAttendance = me ? await personAttendanceFor(tx, academyId, me.personId, sessions.map((s) => s.id)) : new Map<string, AttendanceStatus>();
    return { sessions, myAttendance };
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = localDate(s.startsAt, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const canManage = can(ctx.role, "schedule.manage") && !asMember;
  const canRecord = can(ctx.role, "attendance.record") && !asMember;
  const fmt = (d: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${d}T00:00:00Z`));

  // Semaine en cours : les jours déjà passés sont repliés, pour que la prochaine séance apparaisse sans défiler (téléphone).
  const isCurrentWeek = monday === mondayOf(today);
  const pastDays = isCurrentWeek ? days.filter((d) => d < today && (byDay.get(d)?.length ?? 0) > 0) : [];
  const shownDays = days.filter((d) => !pastDays.includes(d));
  const renderDay = (day: string) => {
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
            <li key={s.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 min-[22rem]:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5">
              <p className="text-lg font-bold font-stretch-[80%] leading-none">
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
                      ? ` · ${s.attended} présent${s.attended > 1 ? "s" : ""}`
                      : ""}
                  {s.notes ? ` · ${s.notes}` : ""}
                </p>
                {isMember && s.myStatus === "waitlisted" && s.endsAt > now && !myAttendance.has(s.id) && <p className="mt-1 text-sm text-warning-ink">{WAITLIST_HINT}</p>}
              </div>
              <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 min-[22rem]:col-span-1 min-[22rem]:flex-col min-[22rem]:items-end sm:flex-row sm:items-center">
                {s.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
                {isMember && myAttendance.has(s.id) && <AttendanceBadge status={myAttendance.get(s.id)!} />}
                {isMember && s.status === "scheduled" && !myAttendance.has(s.id) && (
                  <BookingControls academyId={academyId} sessionId={s.id} label={`${s.classTypeName}, ${formatDateTime(s.startsAt, tz)}`} booking={s} capacity={s.capacity} bookable={s.endsAt > now} />
                )}
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
  };

  return (
    <>
      <PageHeader title="Planning" description={`Semaine du ${fmt(monday)} au ${fmt(sunday)}.`} actions={canManage ? <LinkButton href={`/a/${academyId}/schedule/new`}>Nouvelle séance</LinkButton> : undefined} />
      <Notice searchParams={sp} />

      <nav aria-label="Navigation par semaine" className="mb-4 grid grid-cols-3 rounded-sm border border-line-strong bg-surface p-0.5 sm:inline-grid">
        <Link className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3 text-sm font-semibold no-underline hover:bg-sunken" href={`/a/${academyId}/schedule?week=${addDays(monday, -7)}`}>
          <Icon name="prev" size={18} />
          <span>
            Précédente<span className="sr-only"> semaine</span>
          </span>
        </Link>
        <Link className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3 text-sm font-semibold no-underline hover:bg-sunken" href={`/a/${academyId}/schedule`}>
          Cette semaine
        </Link>
        <Link className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3 text-sm font-semibold no-underline hover:bg-sunken" href={`/a/${academyId}/schedule?week=${addDays(monday, 7)}`}>
          <span>
            Suivante<span className="sr-only"> semaine</span>
          </span>
          <Icon name="next" size={18} />
        </Link>
      </nav>

      {sessions.length === 0 && (
        <EmptyState framed title="Aucune séance cette semaine" action={canManage ? <LinkButton href={`/a/${academyId}/schedule/new`}>Planifier des séances</LinkButton> : undefined}>
          {canManage ? "Créez une séance unique ou une récurrence hebdomadaire (jusqu’à la fin de l’année)." : "Le planning de ce club n'a pas encore de séance pour cette semaine."}
        </EmptyState>
      )}

      <div className={sessions.length ? "overflow-hidden rounded-sm border border-line bg-surface" : ""}>
        {pastDays.length > 0 && (
          <details className="group border-b border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 bg-sunken px-4 text-sm font-semibold text-ink-soft sm:px-5 [&::-webkit-details-marker]:hidden">
              <Icon name="next" size={16} className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
              Plus tôt cette semaine
              <span className="font-normal">({pastDays.map((d) => formatDay(new Date(`${d}T12:00:00Z`), "UTC").split(" ")[0]).join(", ")})</span>
            </summary>
            {pastDays.map(renderDay)}
          </details>
        )}
        {shownDays.map(renderDay)}
      </div>
      {sessions.length > 0 && (
        <p className="mt-4 text-right">
          <Link href={`/a/${academyId}/schedule?week=${addDays(monday, 7)}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold">
            Voir la semaine suivante
            <Icon name="next" size={16} />
          </Link>
        </p>
      )}
    </>
  );
}
