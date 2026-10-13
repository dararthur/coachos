import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTime, localDate, formatDateTime, formatDay } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatGrid } from "@/components/ui/ui";
import { buttonClasses } from "@/components/ui/button-classes";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getDashboardStats, listInactiveMembers } from "@/server/repositories/dashboard";
import { listSessions, type SessionRow } from "@/server/repositories/schedule";
import { WeeklyBars } from "./weekly-bars";

export const metadata: Metadata = { title: "Tableau de bord" };

/** La séance à appeler maintenant : la première non annulée qui n'est pas terminée, sinon la dernière sans appel. */
function focusSession(sessions: SessionRow[], now: Date): SessionRow | undefined {
  const open = sessions.filter((s) => s.status === "scheduled");
  return open.find((s) => s.endsAt > now) ?? [...open].reverse().find((s) => s.recorded === 0);
}
export default async function DashboardPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  if (!can(ctx.role, "dashboard.read")) redirect(`/a/${academyId}/me`);
  const tz = ctx.academy.timezone;
  const now = new Date();
  const today = localDate(now, tz);

  const { stats, todaySessions, inactive } = await inAcademy(ctx, async (tx) => ({
    stats: await getDashboardStats(tx, academyId, tz),
    todaySessions: await listSessions(tx, academyId, tz, { from: today, to: today }),
    inactive: await listInactiveMembers(tx, academyId, tz),
  }));

  const isEmpty = stats.activeMembers === 0 && todaySessions.length === 0 && stats.sessionsThisWeek === 0;
  const focus = focusSession(todaySessions, now);
  const base = `/a/${academyId}`;

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={<span className="first-letter:uppercase">{formatDay(now, tz)} · {ctx.academy.name}</span>}
        actions={can(ctx.role, "schedule.manage") ? <LinkButton href={`${base}/schedule/new`} variant="secondary" icon="plus">Nouvelle séance</LinkButton> : undefined}
      />

      {isEmpty && (
        <Alert tone="info" title="Bienvenue !">
          Commencez par <Link href={`${base}/members/new`}>ajouter vos membres</Link> (ou <Link href={`${base}/members/import`}>importer un CSV</Link>), puis{" "}
          <Link href={`${base}/schedule/new`}>créez vos séances</Link>. Les indicateurs ci-dessous se rempliront avec vos données réelles.
        </Alert>
      )}

      {stats.pastSessionsWithoutAttendance > 0 && (
        <Alert tone="warning" title="Présences à compléter">
          {stats.pastSessionsWithoutAttendance} séance{stats.pastSessionsWithoutAttendance > 1 ? "s" : ""} des 14 derniers jours sans aucune présence enregistrée.{" "}
          <Link href={`${base}/attendance`} className="font-semibold">Compléter les présences</Link>
        </Alert>
      )}
      <StatGrid className="mb-6">
        <Stat label="Membres actifs" value={stats.activeMembers} hint={stats.archivedMembers ? `${stats.archivedMembers} archivé(s)` : undefined} href={`${base}/members`} />
        <Stat label="Séances aujourd'hui" value={stats.sessionsToday} href={`${base}/attendance`} />
        <Stat label="Présences cette semaine" value={stats.attendedThisWeek} hint={`${stats.sessionsThisWeek} séance(s) planifiée(s)`} href={`${base}/reports`} />
        <Stat label="Moyenne par séance" value={stats.avgPerSession30d ?? "—"} hint="30 derniers jours, séances avec appel" />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card title="Séances du jour" flush actions={<Link href={`${base}/schedule`} className="inline-flex min-h-11 items-center text-sm font-semibold">Planning de la semaine</Link>}>
          {todaySessions.length === 0 ? (
            <EmptyState level={3} title="Aucune séance aujourd'hui">Rien de prévu pour la journée.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {todaySessions.map((s) => {
                const isFocus = s.id === focus?.id;
                return (
                  <li key={s.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 ${isFocus ? "bg-accent-soft/45" : ""}`}>
                    <p className="w-14 shrink-0 text-xl font-bold font-stretch-[80%] leading-none">
                      {formatTime(s.startsAt, tz)}
                      <span className="mt-1 block text-xs font-medium font-stretch-100% text-ink-soft">{formatTime(s.endsAt, tz)}</span>
                    </p>
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold ${s.status === "cancelled" ? "text-ink-soft line-through" : ""}`}>{s.classTypeName}</p>
                      <p className="text-sm text-ink-soft">
                        {s.attended} présent{s.attended > 1 ? "s" : ""}
                        {s.capacity ? ` / ${s.capacity} places` : ""}
                        {s.instructorName ? ` · ${s.instructorName}` : ""}
                      </p>
                    </div>
                    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                      {s.status === "cancelled" ? <Badge tone="danger">Annulée</Badge> : s.recorded === 0 ? <Badge tone="warning">Appel à faire</Badge> : <Badge tone="success">Appel fait</Badge>}
                      {s.status === "scheduled" && (
                        <Link href={`${base}/attendance/${s.id}`} className={buttonClasses({ variant: isFocus ? "primary" : "secondary" })}>
                          {s.recorded === 0 ? "Faire l'appel" : "Ouvrir l'appel"}
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Membres à recontacter" flush description={`${stats.inactive30} membre(s) actif(s) sans présence depuis 30 jours.`}>
          {inactive.length === 0 ? (
            <p className="px-4 py-5 text-sm text-ink-soft sm:px-5">Aucun membre inactif : tous les membres actifs sont venus récemment.</p>
          ) : (
            <ul className="divide-y divide-line">
              {inactive.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-1.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/members/${m.id}`} className="flex min-h-11 flex-col justify-center font-semibold no-underline hover:underline">
                      {m.firstName} {m.lastName}
                      <span className="text-xs font-normal text-ink-soft">{m.lastAttendedAt ? `Dernière venue : ${formatDateTime(m.lastAttendedAt, tz)}` : "Jamais venu(e)"}</span>
                    </Link>
                  </div>
                  {m.email && (
                    <LinkButton href={`mailto:${m.email}`} variant="ghost" icon="mail" className="px-3">
                      Écrire<span className="sr-only"> à {m.firstName} {m.lastName}</span>
                    </LinkButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="mt-6" title="Présences par semaine" description="8 dernières semaines, présents et retards. La semaine en cours est incomplète.">
        <WeeklyBars weeks={stats.weekly} />
      </Card>
    </>
  );
}