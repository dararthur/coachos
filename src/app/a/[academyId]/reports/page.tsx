import type { Metadata } from "next";
import { defaultReportRange, ATTENDANCE_LABELS, reportFilterSchema, parseWith } from "@/domain/validation";
import { formatDateTime, localDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Alert, Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Pagination, Stat } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listClassTypes } from "@/server/repositories/academies";
import { listPeople } from "@/server/repositories/members";
import { attendanceReport, REPORT_PAGE_SIZE } from "@/server/repositories/reports";

export const metadata: Metadata = { title: "Rapports" };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { academyId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId, "reports.read");
  const tz = ctx.academy.timezone;
  const today = localDate(new Date(), tz);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const page = Math.max(1, Number.parseInt(str("page") || "1", 10) || 1);

  const defaults = defaultReportRange(today);
  const raw = { from: str("from") || defaults.from, to: str("to") || defaults.to, classTypeId: str("classTypeId"), personId: str("personId") };
  const parsed = parseWith(reportFilterSchema, raw);
  const filters = parsed.ok ? parsed.data : { ...defaults, classTypeId: undefined, personId: undefined };

  const { report, classTypes, people } = await inAcademy(ctx, async (tx) => ({
    report: await attendanceReport(tx, academyId, tz, filters, page),
    classTypes: await listClassTypes(tx, academyId, { includeArchived: true }),
    people: (await listPeople(tx, academyId, { status: "all", page: 1, q: "" })).rows,
  }));

  const qs = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.classTypeId) qs.set("classTypeId", filters.classTypeId);
  if (filters.personId) qs.set("personId", filters.personId);
  const base = `/a/${academyId}/reports`;
  const pageHref = (p: number) => `${base}?${qs.toString()}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <PageHeader
        title="Historique des présences"
        description="Présences enregistrées sur la période, avec export CSV pour les administrateurs."
        actions={can(ctx.role, "reports.export") ? <LinkButton href={`${base}/export?${qs.toString()}`} variant="secondary">Exporter (CSV)</LinkButton> : undefined}
      />

      <Card className="mb-6">
        <form method="get" action={base} role="search" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="from" className="mb-1 block text-sm font-medium">Du</label>
            <input id="from" name="from" type="date" defaultValue={filters.from} required className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-sm font-medium">Au</label>
            <input id="to" name="to" type="date" defaultValue={filters.to} required className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </div>
          <div>
            <label htmlFor="classTypeId" className="mb-1 block text-sm font-medium">Cours</label>
            <select id="classTypeId" name="classTypeId" defaultValue={filters.classTypeId ?? ""} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="">Tous les cours</option>
              {classTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.disciplineName} — {t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="personId" className="mb-1 block text-sm font-medium">Membre</label>
            <select id="personId" name="personId" defaultValue={filters.personId ?? ""} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="">Tous les membres</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.lastName} {p.firstName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="min-h-11 w-full rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">Appliquer</button>
          </div>
        </form>
        {!parsed.ok && <p role="alert" className="mt-3 text-sm font-medium text-red-800">Filtres invalides ({Object.values(parsed.fieldErrors).join(" ")}) : période par défaut affichée.</p>}
      </Card>

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Présents" value={report.summary.present} />
        <Stat label="En retard" value={report.summary.late} />
        <Stat label="Absents" value={report.summary.absent} />
        <Stat label="Membres distincts" value={report.summary.distinctMembers} />
      </dl>

      {report.total === 0 ? (
        <EmptyState title="Aucune présence sur cette période">Modifiez les filtres ou faites l&apos;appel des séances pour alimenter l&apos;historique.</EmptyState>
      ) : (
        <>
          {report.total > 50_000 && <Alert tone="warning">L&apos;export est limité aux 50 000 premières lignes.</Alert>}
          <DataTable caption="Présences sur la période" headers={["Séance", "Cours", "Membre", "Statut"]}>
            {report.rows.map((r) => (
              <tr key={r.attendanceId}>
                <td className="px-4 py-2.5">{formatDateTime(r.startsAt, tz)}</td>
                <td className="px-4 py-2.5">{r.classTypeName}</td>
                <td className="px-4 py-2.5">{r.anonymized ? <span className="text-muted">Membre anonymisé</span> : `${r.lastName.toUpperCase()} ${r.firstName}`}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={r.status === "absent" ? "danger" : r.status === "late" ? "warning" : "success"}>{ATTENDANCE_LABELS[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </DataTable>
          <Pagination page={page} total={report.total} pageSize={REPORT_PAGE_SIZE} hrefFor={pageHref} />
        </>
      )}
    </>
  );
}
