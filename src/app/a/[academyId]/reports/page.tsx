import type { Metadata } from "next";
import { defaultReportRange, ATTENDANCE_LABELS, reportFilterSchema, parseWith } from "@/domain/validation";
import { formatDateTime, localDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import { buttonClasses } from "@/components/ui/button-classes";
import { Alert, Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Pagination, Stat, StatGrid } from "@/components/ui/ui";
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
        title="Rapports"
        description="Historique des présences enregistrées sur la période choisie."
        actions={
          <>
            <LinkButton href={`/a/${academyId}/ranking`} variant="secondary" icon="trophy">Classement</LinkButton>
            {can(ctx.role, "reports.export") && <LinkButton href={`${base}/export?${qs.toString()}`} variant="secondary" icon="download" download>Exporter (CSV)</LinkButton>}
          </>
        }
      />

      <Card className="mb-6">
        <form method="get" action={base} role="search" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="from" className="mb-1.5 block text-sm font-semibold">Du</label>
            <input id="from" name="from" type="date" defaultValue={filters.from} required className="field" />
          </div>
          <div>
            <label htmlFor="to" className="mb-1.5 block text-sm font-semibold">Au</label>
            <input id="to" name="to" type="date" defaultValue={filters.to} required className="field" />
          </div>
          <div>
            <label htmlFor="classTypeId" className="mb-1.5 block text-sm font-semibold">Cours</label>
            <select id="classTypeId" name="classTypeId" defaultValue={filters.classTypeId ?? ""} className="field">
              <option value="">Tous les cours</option>
              {classTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.disciplineName} — {t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="personId" className="mb-1.5 block text-sm font-semibold">Membre</label>
            <select id="personId" name="personId" defaultValue={filters.personId ?? ""} className="field">
              <option value="">Tous les membres</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.lastName} {p.firstName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className={buttonClasses({ className: "w-full" })}>Appliquer</button>
          </div>
        </form>
        {!parsed.ok && <p role="alert" className="mt-3 text-sm font-semibold text-danger">Filtres invalides ({Object.values(parsed.fieldErrors).join(" ")}) : période par défaut affichée.</p>}
      </Card>

      <StatGrid className="mb-6">
        <Stat label="Présents" value={report.summary.present} />
        <Stat label="En retard" value={report.summary.late} />
        <Stat label="Absents" value={report.summary.absent} />
        <Stat label="Membres distincts" value={report.summary.distinctMembers} />
      </StatGrid>

      {report.total === 0 ? (
        <EmptyState framed title="Aucune présence sur cette période">Modifiez les filtres ou faites l&apos;appel des séances pour alimenter l&apos;historique.</EmptyState>
      ) : (
        <>
          {report.total > 50_000 && <Alert tone="warning">L&apos;export est limité aux 50 000 premières lignes.</Alert>}
          <div className="hidden md:block">
          <DataTable caption="Présences sur la période" headers={["Séance", "Cours", "Membre", "Statut"]}>
            {report.rows.map((r) => (
              <tr key={r.attendanceId}>
                <td className="px-4 py-2.5">{formatDateTime(r.startsAt, tz)}</td>
                <td className="px-4 py-2.5">{r.classTypeName}</td>
                <td className="px-4 py-2.5">{r.anonymized ? <span className="text-ink-soft">Membre anonymisé</span> : `${r.lastName.toUpperCase()} ${r.firstName}`}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={r.status === "absent" ? "danger" : r.status === "late" ? "warning" : "success"}>{ATTENDANCE_LABELS[r.status]}</Badge>
                </td>
              </tr>
            ))}
          </DataTable>
          </div>
          <ul className="divide-y divide-line rounded-sm border border-line bg-surface md:hidden">
            {report.rows.map((r) => (
              <li key={r.attendanceId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.anonymized ? <span className="font-normal text-ink-soft">Membre anonymisé</span> : `${r.lastName.toUpperCase()} ${r.firstName}`}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {formatDateTime(r.startsAt, tz)} · {r.classTypeName}
                  </span>
                </span>
                <Badge tone={r.status === "absent" ? "danger" : r.status === "late" ? "warning" : "success"}>{ATTENDANCE_LABELS[r.status]}</Badge>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={report.total} pageSize={REPORT_PAGE_SIZE} hrefFor={pageHref} />
        </>
      )}
    </>
  );
}
