import type { Metadata } from "next";
import Link from "next/link";
import { formatCalendarDate, formatDateTime } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Badge, DataTable, EmptyState, LinkButton, Notice, PageHeader, Pagination } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listPeople, PAGE_SIZE, type MemberStatus } from "@/server/repositories/members";

export const metadata: Metadata = { title: "Membres" };

const STATUS_TABS: { value: MemberStatus; label: string }[] = [
  { value: "active", label: "Actifs" },
  { value: "archived", label: "Archivés" },
  { value: "all", label: "Tous" },
];

export default async function MembersPage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { academyId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId, "members.read");
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const status = STATUS_TABS.some((t) => t.value === sp.status) ? (sp.status as MemberStatus) : "active";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);

  const { rows, total } = await inAcademy(ctx, (tx) => listPeople(tx, academyId, { q, status, page }));
  const tz = ctx.academy.timezone;
  const hrefFor = (p: number, s: MemberStatus = status) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (s !== "active") u.set("status", s);
    if (p > 1) u.set("page", String(p));
    const qs = u.toString();
    return `/a/${academyId}/members${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Membres"
        description="Adhérents adultes du club. Aucune donnée de santé n'est collectée."
        actions={
          <>
            {can(ctx.role, "members.import") && (
              <LinkButton href={`/a/${academyId}/members/import`} variant="secondary">
                Importer un CSV
              </LinkButton>
            )}
            {can(ctx.role, "reports.export") && (
              <LinkButton href={`/a/${academyId}/members/export`} variant="secondary" download>
                Exporter (CSV)
              </LinkButton>
            )}
            {can(ctx.role, "members.create") && <LinkButton href={`/a/${academyId}/members/new`}>Nouveau membre</LinkButton>}
          </>
        }
      />
      <Notice searchParams={sp} />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form method="get" action={`/a/${academyId}/members`} role="search" className="flex flex-wrap items-end gap-2">
          {status !== "active" && <input type="hidden" name="status" value={status} />}
          <div>
            <label htmlFor="q" className="mb-1 block text-sm font-medium">
              Rechercher
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Nom, prénom ou e-mail" maxLength={100} className="block min-h-11 w-64 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </div>
          <button type="submit" className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
            Rechercher
          </button>
        </form>
        <nav aria-label="Filtrer par statut" className="flex gap-1">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.value}
              href={hrefFor(1, t.value)}
              aria-current={t.value === status ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium no-underline ${t.value === status ? "bg-brand-600 text-white" : "bg-white text-ink ring-1 ring-slate-300 hover:bg-slate-50"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        q || status !== "active" ? (
          <EmptyState title="Aucun résultat">Aucun membre ne correspond à ces critères.</EmptyState>
        ) : (
          <EmptyState
            title="Aucun membre pour le moment"
            action={
              <div className="flex flex-wrap gap-2">
                {can(ctx.role, "members.create") && <LinkButton href={`/a/${academyId}/members/new`}>Ajouter un membre</LinkButton>}
                {can(ctx.role, "members.import") && (
                  <LinkButton href={`/a/${academyId}/members/import`} variant="secondary">
                    Importer un CSV
                  </LinkButton>
                )}
              </div>
            }
          >
            Ajoutez vos adhérents un par un ou importez l&apos;export de votre ancien logiciel.
          </EmptyState>
        )
      ) : (
        <>
          <DataTable caption="Liste des membres" headers={["Nom", "E-mail", "Inscription", "Dernière présence", "Statut"]}>
            {rows.map((p) => (
              <tr key={p.id}>
                <th scope="row" className="px-4 py-3 font-medium">
                  <Link href={`/a/${academyId}/members/${p.id}`} className="-my-3 flex min-h-11 items-center py-3">
                    {p.lastName.toUpperCase()} {p.firstName}
                  </Link>
                </th>
                <td className="px-4 py-3 text-muted">{p.email ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{p.joinedOn ? formatCalendarDate(p.joinedOn) : "—"}</td>
                <td className="px-4 py-3 text-muted">{p.lastAttendedAt ? formatDateTime(p.lastAttendedAt, tz) : "—"}</td>
                <td className="px-4 py-3">{p.archivedAt ? <Badge>Archivé</Badge> : <Badge tone="success">Actif</Badge>}</td>
              </tr>
            ))}
          </DataTable>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} hrefFor={(p) => hrefFor(p)} />
        </>
      )}
    </>
  );
}
