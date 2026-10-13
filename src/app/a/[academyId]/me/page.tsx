import type { Metadata } from "next";
import { addDays, formatDateTime, localDate } from "@/domain/dates";
import { ATTENDANCE_LABELS } from "@/domain/validation";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listSessions } from "@/server/repositories/schedule";

export const metadata: Metadata = { title: "Mon espace" };

/** Vue d'un adhérent connecté : planning à venir et ses propres présences (la RLS ne renvoie que ses lignes). */
export default async function MePage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);
  const { upcoming, mine } = await inAcademy(ctx, async (tx) => ({
    upcoming: await listSessions(tx, academyId, tz, { from: today, to: addDays(today, 13) }),
    mine: await tx<{ startsAt: Date; classTypeName: string; status: "present" | "late" | "absent" }[]>`
      select s.starts_at as "startsAt", ct.name as "classTypeName", a.status
      from public.attendance a
      join public.sessions s on s.id = a.session_id and s.academy_id = a.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where a.academy_id = ${academyId}
      order by s.starts_at desc limit 100`,
  }));
  return (
    <>
      <PageHeader title="Mon espace" description={`Bienvenue dans « ${ctx.academy.name} ».`} />
      <div className="space-y-6">
        <Card title="Prochaines séances (14 jours)">
          {upcoming.length === 0 ? (
            <EmptyState title="Aucune séance prévue" />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                  <span className={s.status === "cancelled" ? "text-muted line-through" : "font-medium"}>
                    {formatDateTime(s.startsAt, tz)} · {s.classTypeName}
                  </span>
                  {s.status === "cancelled" && <Badge tone="danger">Annulée</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Mes présences">
          {mine.length === 0 ? (
            <EmptyState title="Aucune présence enregistrée">Vos présences apparaîtront ici après vos prochains cours.</EmptyState>
          ) : (
            <DataTable caption="Mes présences" headers={["Séance", "Cours", "Statut"]}>
              {mine.map((m) => (
                <tr key={`${m.startsAt.toISOString()}-${m.classTypeName}`}>
                  <td className="px-4 py-2.5">{formatDateTime(m.startsAt, tz)}</td>
                  <td className="px-4 py-2.5">{m.classTypeName}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={m.status === "absent" ? "danger" : m.status === "late" ? "warning" : "success"}>{ATTENDANCE_LABELS[m.status]}</Badge>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
