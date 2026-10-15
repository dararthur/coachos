import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, formatDateTime, formatDay, formatTime, localDate } from "@/domain/dates";
import { SCAN_PATH } from "@/domain/checkin";
import type { AttendanceStatus } from "@/domain/validation";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/ui";
import { BookingControls, occupancyLabel, WAITLIST_HINT } from "@/components/ui/booking";
import { Assiduity, Tally, weeksAttended } from "@/components/ui/assiduity";
import { Avatar } from "@/components/ui/avatar";
import { BeltLabel } from "@/components/ui/belt";
import { assiduityLabel, myRank, type MonthRank } from "@/domain/assiduity";
import { ordinal, rankingRange } from "@/domain/ranking";
import type { MyProfile } from "@/server/repositories/profile";
import { photoVersions } from "@/server/repositories/photos";
import { attendanceRanking } from "@/server/repositories/ranking";
import { AttendanceBadge, AttendanceHistory } from "@/components/ui/attendance-history";
import { Icon } from "@/components/ui/icons";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getMyProfile } from "@/server/repositories/profile";
import { personHistory, type PersonAttendanceRow } from "@/server/repositories/attendance";
import { attachBookings, type BookableSession } from "@/server/repositories/bookings";
import { getCheckinSettings } from "@/server/repositories/checkin";
import { listSessions } from "@/server/repositories/schedule";
import { ChildrenCard } from "@/components/guardian/children-card";
import { myChildren } from "@/server/repositories/guardian";

export const metadata: Metadata = { title: "Mon espace" };

const UPCOMING_SHOWN = 3;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sessionLabel = (s: BookableSession, tz: string) => `${s.classTypeName}, ${formatDateTime(s.startsAt, tz)}`;

/**
 * Vue d'un adhérent connecté. Une seule action orange, qui dépend du moment : « Pointer ma présence » pendant la fenêtre
 * de pointage d'un cours, sinon « Réserver » le prochain cours. Le reste du planning est en secondaire ; l'historique est
 * replié par mois.
 */
export default async function MePage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  const tz = ctx.academy.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const month = rankingRange("mois", today);
  const { upcoming, mine, profile, checkin, photoVersion, rank, children } = await inAcademy(ctx, async (tx) => {
    const profile = await getMyProfile(tx, academyId);
    return {
      profile,
      children: (await myChildren(tx)).filter((c) => c.academyId === academyId),
      photoVersion: profile ? (await photoVersions(tx, academyId)).get(profile.personId) : undefined,
      rank: profile ? myRank(await attendanceRanking(tx, academyId, month.from, month.to)) : null,
      checkin: await getCheckinSettings(tx, academyId),
      upcoming: await attachBookings(tx, academyId, await listSessions(tx, academyId, tz, { from: today, to: addDays(today, 13) })),
      // Ses propres présences, filtrées sur sa fiche (la RLS laisserait voir au staff celles de tout le club).
      mine: profile ? await personHistory(tx, academyId, profile.personId, 100) : [],
    };
  });
  // Fiche créée automatiquement à l'arrivée : le membre la complète une première fois (grade, majorité).
  if (profile && !profile.completed) redirect(`/a/${academyId}/profile`);

  const attended = new Map<string, AttendanceStatus>(mine.map((m) => [m.sessionId, m.status]));
  const live = upcoming.filter((s) => s.status === "scheduled" && s.endsAt > now);
  const opensAt = (s: BookableSession) => new Date(s.startsAt.getTime() - checkin.beforeMinutes * 60_000);
  const closesAt = (s: BookableSession) => new Date(s.startsAt.getTime() + checkin.afterMinutes * 60_000);
  // Le cours du moment (fenêtre de pointage ouverte), sinon le prochain cours réservé, sinon le prochain cours au planning.
  const focus =
    live.find((s) => opensAt(s) <= now && now <= closesAt(s)) ?? live.find((s) => s.myStatus !== null) ?? live[0] ?? null;
  const others = upcoming.filter((s) => s.endsAt > now && s.id !== focus?.id);

  return (
    <>
      <PageHeader
        title="Mon espace"
        description={`Bienvenue dans « ${ctx.academy.name} ».`}
        actions={profile ? <LinkButton href={`/a/${academyId}/profile`} variant="secondary" icon="user">Mon profil</LinkButton> : undefined}
      />
      <div className="space-y-6">
        <ChildrenCard childrenRows={children} showClub={false} />
        {focus ? (
          <NextClass
            session={focus}
            tz={tz}
            today={today}
            now={now}
            academyId={academyId}
            attendedStatus={attended.get(focus.id) ?? null}
            opensAt={opensAt(focus)}
            closesAt={closesAt(focus)}
            fixedMode={checkin.mode === "fixed"}
          />
        ) : (
          <EmptyState framed title="Aucun cours dans les 14 prochains jours">
            Le planning du club n&apos;a pas encore de séance à venir.
          </EmptyState>
        )}

        {profile && rank ? (
          <MyBelt academyId={academyId} profile={profile} photoVersion={photoVersion} weeks={weeksAttended(mine, tz)} rank={rank} />
        ) : (
          <Assiduity weeks={weeksAttended(mine, tz)} />
        )}

        {others.length > 0 && (
          <Card
            title="Ensuite"
            flush
            actions={
              <Link href={`/a/${academyId}/schedule`} className="inline-flex min-h-11 items-center text-sm font-semibold">
                Tout le planning
              </Link>
            }
          >
            <ul className="divide-y divide-line">
              {others.slice(0, UPCOMING_SHOWN).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className={s.status === "cancelled" ? "text-ink-soft line-through" : "font-semibold"}>
                      {formatDateTime(s.startsAt, tz)} · {s.classTypeName}
                    </p>
                    {s.status === "scheduled" && <p className="text-sm text-ink-soft">{occupancyLabel(s, s.capacity)}</p>}
                    {s.myStatus === "waitlisted" && !attended.has(s.id) && <p className="mt-1 text-sm text-warning-ink">{WAITLIST_HINT}</p>}
                  </div>
                  <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    {s.status === "cancelled" ? (
                      <Badge tone="danger">Annulée</Badge>
                    ) : attended.has(s.id) ? (
                      <AttendanceBadge status={attended.get(s.id)!} />
                    ) : (
                      <BookingControls academyId={academyId} sessionId={s.id} label={sessionLabel(s, tz)} booking={s} capacity={s.capacity} bookable />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {others.length > UPCOMING_SHOWN && (
              <p className="border-t border-line px-4 py-3 text-sm text-ink-soft sm:px-5">
                {others.length - UPCOMING_SHOWN} autre{others.length - UPCOMING_SHOWN > 1 ? "s" : ""} séance{others.length - UPCOMING_SHOWN > 1 ? "s" : ""} d&apos;ici deux semaines,{" "}
                <Link href={`/a/${academyId}/schedule`}>dans le planning</Link>.
              </p>
            )}
          </Card>
        )}

        <Card title="Mes présences" flush>
          {mine.length === 0 ? (
            <EmptyState level={3} title="Aucune présence enregistrée">Vos présences apparaîtront ici après vos prochains cours.</EmptyState>
          ) : (
            <HistoryByMonth rows={mine} tz={tz} />
          )}
        </Card>
      </div>
    </>
  );
}

/** Ma ceinture : qui je suis au club (photo ou silhouette, grade), mon assiduité et mon rang du mois. */
function MyBelt({ academyId, profile, photoVersion, weeks, rank }: { academyId: string; profile: MyProfile; photoVersion: number | undefined; weeks: boolean[]; rank: MonthRank }) {
  return (
    <section aria-labelledby="ma-ceinture" className="rounded-sm border border-line bg-surface">
      <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
        <Avatar academyId={academyId} personId={profile.personId} avatarStyle={profile.avatarStyle} hasPhoto={photoVersion !== undefined} version={photoVersion} />
        <div className="min-w-0 flex-1">
          <h2 id="ma-ceinture" className="text-lg font-bold leading-6">
            {profile.firstName} {profile.lastName}
          </h2>
          <BeltLabel belt={profile.belt} stripes={profile.beltStripes} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-4 py-3.5 sm:px-5">
        <Tally weeks={weeks} />
        <p className="text-sm">
          <span className="block font-semibold">Assiduité</span>
          <span className="text-ink-soft">{assiduityLabel(weeks)}</span>
        </p>
        <p className="text-sm sm:ml-auto sm:text-right">
          <span className="block">
            {rank.rank !== null ? (
              <>
                <strong className="text-lg font-bold font-stretch-[80%] tabular-nums">{ordinal(rank.rank)}</strong> ce mois-ci{rank.tied ? " (ex æquo)" : ""}
              </>
            ) : (
              <span className="text-ink-soft">Pas encore de venue ce mois-ci</span>
            )}
          </span>
          <Link href={`/a/${academyId}/ranking`}>Voir le classement</Link>
        </p>
      </div>
    </section>
  );
}

/** Le cours qui compte maintenant : grande heure, statut, et l'unique action orange de l'écran. */
function NextClass({
  session: s,
  tz,
  today,
  now,
  academyId,
  attendedStatus,
  opensAt,
  closesAt,
  fixedMode,
}: {
  session: BookableSession;
  tz: string;
  today: string;
  now: Date;
  academyId: string;
  attendedStatus: AttendanceStatus | null;
  opensAt: Date;
  closesAt: Date;
  fixedMode: boolean;
}) {
  const day = localDate(s.startsAt, tz);
  const dayLabel = day === today ? "Aujourd'hui" : day === addDays(today, 1) ? "Demain" : capitalize(formatDay(s.startsAt, tz));
  const open = opensAt <= now && now <= closesAt;
  const booked = s.myStatus === "booked";
  const title = open ? "C'est l'heure du cours" : s.myStatus ? "Mon prochain cours" : "Prochain cours";
  return (
    <Card title={title} flush>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-4 py-4 sm:px-5">
        <p className="shrink-0 leading-none">
          <span className="block text-figure font-bold font-stretch-[75%] tabular-nums">{formatTime(s.startsAt, tz)}</span>
          <span className="mt-1.5 block text-sm font-semibold text-ink-soft">{dayLabel}</span>
        </p>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-lg font-bold">{s.classTypeName}</p>
          <p className="text-sm text-ink-soft">
            {s.disciplineName}
            {s.instructorName ? ` · ${s.instructorName}` : ""} · {occupancyLabel(s, s.capacity)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3.5 sm:px-5">
        {attendedStatus ? (
          <>
            <AttendanceBadge status={attendedStatus} />
            <p className="text-sm text-ink-soft">Présence enregistrée pour ce cours.</p>
          </>
        ) : open && s.myStatus !== "waitlisted" ? (
          <>
            <LinkButton href={SCAN_PATH} icon="qr" className="w-full sm:w-auto">
              Pointer ma présence
            </LinkButton>
            <p className="text-sm text-ink-soft">
              {fixedMode ? "Scannez l'affiche du club." : "Scannez le QR code affiché par le coach."}
              {!booked && " Vous n'avez pas réservé : un seul geste réserve et pointe."}
            </p>
          </>
        ) : (
          <>
            <BookingControls academyId={academyId} sessionId={s.id} label={sessionLabel(s, tz)} booking={s} capacity={s.capacity} bookable emphasis="primary" />
            <p className="min-w-0 flex-1 basis-56 text-sm text-ink-soft">
              {s.myStatus === "waitlisted"
                ? WAITLIST_HINT
                : booked
                  ? fixedMode
                    ? `Place réservée. Le pointage ouvre à ${formatTime(opensAt, tz)}${localDate(opensAt, tz) === today ? "" : `, ${formatDay(opensAt, tz)}`}.`
                    : "Place réservée. Pointez au début du cours avec le QR code du coach."
                  : "La réservation est nécessaire pour pointer votre présence."}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

const MONTH = (tz: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, month: "long", year: "numeric" });

/** Historique replié par mois : le mois en cours ouvert, les précédents résumés en une ligne. */
function HistoryByMonth({ rows, tz }: { rows: PersonAttendanceRow[]; tz: string }) {
  const months: { key: string; label: string; rows: PersonAttendanceRow[] }[] = [];
  for (const r of rows) {
    const key = localDate(r.startsAt, tz).slice(0, 7);
    let m = months.at(-1);
    if (!m || m.key !== key) months.push((m = { key, label: capitalize(MONTH(tz).format(r.startsAt)), rows: [] }));
    m.rows.push(r);
  }
  return (
    <div className="divide-y divide-line">
      {months.map((m, i) => {
        const came = m.rows.filter((r) => r.status !== "absent").length;
        const absent = m.rows.length - came;
        return (
          <details key={m.key} open={i === 0} className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 bg-sunken px-4 py-2 text-sm sm:px-5 [&::-webkit-details-marker]:hidden">
              <Icon name="next" size={16} className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
              <span className="font-bold">{m.label}</span>
              <span className="ml-auto text-ink-soft tabular-nums">
                {came} venue{came > 1 ? "s" : ""}
                {absent > 0 ? ` · ${absent} absence${absent > 1 ? "s" : ""}` : ""}
              </span>
            </summary>
            <AttendanceHistory
              caption={`Mes présences, ${m.label.toLowerCase()}`}
              tz={tz}
              rows={m.rows.map((r) => ({ key: r.sessionId, startsAt: r.startsAt, classTypeName: r.classTypeName, status: r.status }))}
            />
          </details>
        );
      })}
    </div>
  );
}
