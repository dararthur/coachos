import type { Metadata } from "next";
import { addDays, formatDateTime, localDate } from "@/domain/dates";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/ui";
import { BookingControls, occupancyLabel, WAITLIST_HINT } from "@/components/ui/booking";
import { Assiduity, weeksAttended } from "@/components/ui/assiduity";
import { AttendanceBadge, AttendanceHistory } from "@/components/ui/attendance-history";
import { redirect } from "next/navigation";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getMyProfile } from "@/server/repositories/profile";
import { personHistory } from "@/server/repositories/attendance";
import { getCheckinSettings } from "@/server/repositories/checkin";
import { SCAN_PATH } from "@/domain/checkin";
import { attachBookings } from "@/server/repositories/bookings";
import { listSessions } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Mon espace" };

/** Vue d'un adhérent connecté : planning à venir et ses propres présences (la RLS ne renvoie que ses lignes). */
export default async function MePage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  const tz = ctx.academy.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const { upcoming, mine, profile, checkinMode } = await inAcademy(ctx, async (tx) => {
    const profile = await getMyProfile(tx, academyId);
    return {
      profile,
      checkinMode: (await getCheckinSettings(tx, academyId)).mode,
      upcoming: await attachBookings(tx, academyId, await listSessions(tx, academyId, tz, { from: today, to: addDays(today, 13) })),
      // Ses propres présences, filtrées sur sa fiche (la RLS laisserait voir au staff celles de tout le club).
      mine: profile ? await personHistory(tx, academyId, profile.personId, 100) : [],
    };
  });
  // Fiche créée automatiquement à l'arrivée : le membre la complète une première fois (grade, majorité).
  if (profile && !profile.completed) redirect(`/a/${academyId}/profile`);
  const comingUp = upcoming.filter((s) => s.endsAt > now);
  const attendedBySession = new Map(mine.map((m) => [m.sessionId, m.status]));
  return (
    <>
      <PageHeader
        title="Mon espace"
        description={`Bienvenue dans « ${ctx.academy.name} ».`}
        actions={profile ? <LinkButton href={`/a/${academyId}/profile`} variant="secondary" icon="user">Mon profil</LinkButton> : undefined}
      />
      <div className="space-y-6">
        <Card title="Pointer ma présence" description={checkinMode === "fixed" ? "À votre arrivée, scannez l'affiche du club." : "Au début du cours, scannez le QR code affiché par le coach."} className="border-bar! bg-bar! text-white [&_h2]:text-white [&_p]:text-bar-muted">
          <LinkButton href={SCAN_PATH} icon="qr" className="w-full sm:w-auto">Scanner le QR code</LinkButton>
        </Card>
        <Assiduity weeks={weeksAttended(mine, tz)} />
        <Card title="Prochaines séances" description="14 prochains jours. Réservez votre place : elle est nécessaire pour pointer votre présence." flush>
          {comingUp.length === 0 ? (
            <EmptyState level={3} title="Aucune séance prévue" />
          ) : (
            <ul className="divide-y divide-line">
              {comingUp.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className={s.status === "cancelled" ? "text-ink-soft line-through" : "font-semibold"}>
                      {formatDateTime(s.startsAt, tz)} · {s.classTypeName}
                    </p>
                    {s.status === "scheduled" && <p className="text-sm text-ink-soft">{occupancyLabel(s, s.capacity)}</p>}
                    {s.myStatus === "waitlisted" && !attendedBySession.has(s.id) && <p className="mt-1 text-sm text-warning-ink">{WAITLIST_HINT}</p>}
                  </div>
                  {s.status === "cancelled" ? (
                    <Badge tone="danger">Annulée</Badge>
                  ) : attendedBySession.has(s.id) ? (
                    <AttendanceBadge status={attendedBySession.get(s.id)!} />
                  ) : (
                    <BookingControls academyId={academyId} sessionId={s.id} label={`${s.classTypeName}, ${formatDateTime(s.startsAt, tz)}`} booking={s} capacity={s.capacity} bookable={true} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Mes présences" flush>
          {mine.length === 0 ? (
            <EmptyState level={3} title="Aucune présence enregistrée">Vos présences apparaîtront ici après vos prochains cours.</EmptyState>
          ) : (
            <AttendanceHistory caption="Mes présences" tz={tz} rows={mine.map((m) => ({ key: m.sessionId, startsAt: m.startsAt, classTypeName: m.classTypeName, status: m.status }))} />
          )}
        </Card>
      </div>
    </>
  );
}
