import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTime, localDate, formatDateTime, formatDay } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getDashboardStats, listInactiveMembers } from "@/server/repositories/dashboard";
import { listSessions } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function DashboardPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  if (!can(ctx.role, "dashboard.read")) redirect(`/a/${academyId}/me`);
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);

  const { stats, todaySessions, inactive } = await inAcademy(ctx, async (tx) => ({
    stats: await getDashboardStats(tx, academyId, tz),
    todaySessions: await listSessions(tx, academyId, tz, { from: today, to: today }),
    inactive: await listInactiveMembers(tx, academyId, tz),
  }));

  const isEmpty = stats.activeMembers === 0 && todaySessions.length === 0 && stats.sessionsThisWeek === 0;
  const max = Math.max(1, ...stats.weekly.map((w) => w.attended));

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`Situation de « ${ctx.academy.name} » — ${formatDay(new Date(), tz)}.`}
        actions={can(ctx.role, "schedule.manage") ? <LinkButton href={`/a/${academyId}/schedule/new`}>Nouvelle séance</LinkButton> : undefined}
      />

      {isEmpty && (
        <Alert tone="info" title="Bienvenue !">
          Commencez par <Link href={`/a/${academyId}/members/new`}>ajouter vos membres</Link> (ou <Link href={`/a/${academyId}/members/import`}>importer un CSV</Link>), puis{" "}
          <Link href={`/a/${academyId}/schedule/new`}>créez vos séances</Link>. Les indicateurs ci-dessous se rempliront avec vos données réelles.
        </Alert>
      )}

      {stats.pastSessionsWithoutAttendance > 0 && (
        <Alert tone="warning" title="Présences à compléter">
          {stats.pastSessionsWithoutAttendance} séance{stats.pastSessionsWithoutAttendance > 1 ? "s" : ""} des 14 derniers jours sans aucune présence enregistrée.{" "}
          <Link href={`/a/${academyId}/attendance`}>Compléter les présences</Link>
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Membres actifs" value={stats.activeMembers} hint={stats.archivedMembers ? `${stats.archivedMembers} archivé(s)` : undefined} href={`/a/${academyId}/members`} />
        <Stat label="Séances aujourd'hui" value={stats.sessionsToday} href={`/a/${academyId}/attendance`} />
        <Stat label="Présences cette semaine" value={stats.attendedThisWeek} hint={`${stats.sessionsThisWeek} séance(s) planifiée(s)`} href={`/a/${academyId}/reports`} />
        <Stat label="Moyenne par séance" value={stats.avgPerSession30d ?? "—"} hint="30 derniers jours, séances avec appel" />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Séances du jour" actions={<Link href={`/a/${academyId}/schedule`}>Planning</Link>}>
          {todaySessions.length === 0 ? (
            <EmptyState title="Aucune séance aujourd'hui">Rien de prévu pour la journée.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {todaySessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">
                      {formatTime(s.startsAt, tz)}–{formatTime(s.endsAt, tz)} · {s.classTypeName}
                    </p>
                    <p className="text-sm text-muted">
                      {s.attended} présent{s.attended > 1 ? "s" : ""}
                      {s.capacity ? ` / ${s.capacity} places` : ""}
                      {s.instructorName ? ` · ${s.instructorName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.status === "cancelled" ? <Badge tone="danger">Annulée</Badge> : s.recorded === 0 ? <Badge tone="warning">Appel à faire</Badge> : <Badge tone="success">Appel fait</Badge>}
                    {s.status === "scheduled" && (
                      <Link href={`/a/${academyId}/attendance/${s.id}`} className="text-sm font-medium">
                        Ouvrir l&apos;appel
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Présences par semaine" description="8 dernières semaines (présents + retards).">
          <svg viewBox="0 0 320 140" role="img" aria-label="Histogramme des présences par semaine" className="h-auto w-full">
            {stats.weekly.map((w, i) => {
              const h = Math.round((w.attended / max) * 100);
              return (
                <g key={w.weekStart}>
                  <rect x={i * 40 + 6} y={110 - h} width={28} height={h} rx={3} className="fill-brand-600" />
                  <text x={i * 40 + 20} y={104 - h} textAnchor="middle" className="fill-slate-700 text-[10px]">
                    {w.attended}
                  </text>
                  <text x={i * 40 + 20} y={128} textAnchor="middle" className="fill-slate-600 text-[9px]">
                    {w.weekStart.slice(8)}/{w.weekStart.slice(5, 7)}
                  </text>
                </g>
              );
            })}
          </svg>
          <table className="sr-only">
            <caption>Présences par semaine (début de semaine)</caption>
            <thead>
              <tr>
                <th scope="col">Semaine</th>
                <th scope="col">Présences</th>
              </tr>
            </thead>
            <tbody>
              {stats.weekly.map((w) => (
                <tr key={w.weekStart}>
                  <td>{w.weekStart}</td>
                  <td>{w.attended}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-6" title="Membres à recontacter" description={`${stats.inactive30} membre(s) actif(s) sans présence depuis 30 jours (inscrits depuis plus de 30 jours).`}>
        {inactive.length === 0 ? (
          <p className="text-sm text-muted">Aucun membre inactif : tous les membres actifs sont venus récemment.</p>
        ) : (
          <ul className="divide-y divide-line">
            {inactive.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/a/${academyId}/members/${m.id}`} className="font-medium">
                  {m.firstName} {m.lastName}
                </Link>
                <span className="text-sm text-muted">{m.lastAttendedAt ? `Dernière présence : ${formatDateTime(m.lastAttendedAt, tz)}` : "Jamais venu(e)"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
