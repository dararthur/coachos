import type { Metadata } from "next";
import { addDays, formatDateTime, localDate } from "@/domain/dates";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/ui";
import { Assiduity, weeksAttended } from "@/components/ui/assiduity";
import { AttendanceHistory } from "@/components/ui/attendance-history";
import { redirect } from "next/navigation";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getMyProfile } from "@/server/repositories/profile";
import { listSessions } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Mon espace" };

/** Vue d'un adhérent connecté : planning à venir et ses propres présences (la RLS ne renvoie que ses lignes). */
export default async function MePage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);
  const { upcoming, mine, profile } = await inAcademy(ctx, async (tx) => ({
    profile: await getMyProfile(tx, academyId),
    upcoming: await listSessions(tx, academyId, tz, { from: today, to: addDays(today, 13) }),
    mine: await tx<{ startsAt: Date; classTypeName: string; status: "present" | "late" | "absent" }[]>`
      select s.starts_at as "startsAt", ct.name as "classTypeName", a.status
      from public.attendance a
      join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where a.academy_id = ${academyId}
      order by s.starts_at desc limit 100`,
  }));
  // Fiche créée automatiquement à l'arrivée : le membre la complète une première fois (grade, majorité).
  if (profile && !profile.completed) redirect(`/a/${academyId}/profile`);
  return (
    <>
      <PageHeader
        title="Mon espace"
        description={`Bienvenue dans « ${ctx.academy.name} ».`}
        actions={profile ? <LinkButton href={`/a/${academyId}/profile`} variant="secondary" icon="user">Mon profil</LinkButton> : undefined}
      />
      <div className="space-y-6">
        <Card title="Pointer ma présence" description="Au début du cours, scannez le QR code affiché par le coach." className="border-bar! bg-bar! text-white [&_h2]:text-white [&_p]:text-bar-muted">
          <LinkButton href="/checkin" icon="qr" className="w-full sm:w-auto">Scanner le QR code</LinkButton>
        </Card>
        <Assiduity weeks={weeksAttended(mine, tz)} />
        <Card title="Prochaines séances" description="14 prochains jours." flush>
          {upcoming.length === 0 ? (
            <EmptyState level={3} title="Aucune séance prévue" />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                  <span className={s.status === "cancelled" ? "text-ink-soft line-through" : "font-semibold"}>
                    {formatDateTime(s.startsAt, tz)} · {s.classTypeName}
                  </span>
                  {s.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Mes présences" flush>
          {mine.length === 0 ? (
            <EmptyState level={3} title="Aucune présence enregistrée">Vos présences apparaîtront ici après vos prochains cours.</EmptyState>
          ) : (
            <AttendanceHistory caption="Mes présences" tz={tz} rows={mine.map((m) => ({ key: `${m.startsAt.toISOString()}-${m.classTypeName}`, startsAt: m.startsAt, classTypeName: m.classTypeName, status: m.status }))} />
          )}
        </Card>
      </div>
    </>
  );
}
