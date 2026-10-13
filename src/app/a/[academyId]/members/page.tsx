import type { Metadata } from "next";
import Link from "next/link";
import { formatCalendarDate, formatDateTime } from "@/domain/dates";
import { can } from "@/domain/roles";
import { buttonClasses } from "@/components/ui/button-classes";
import { Icon } from "@/components/ui/icons";
import { Badge, DataTable, EmptyState, LinkButton, Notice, PageHeader, Pagination, TabNav } from "@/components/ui/ui";
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
  // Sous le filtre « Actifs », le statut est le même pour toutes les lignes : la colonne n'apporte rien.
  const showStatus = status !== "active";
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
              <LinkButton href={`/a/${academyId}/members/import`} variant="secondary" icon="upload">
                Importer un CSV
              </LinkButton>
            )}
            {can(ctx.role, "reports.export") && (
              <LinkButton href={`/a/${academyId}/members/export`} variant="secondary" icon="download" download>
                Exporter (CSV)
              </LinkButton>
            )}
            {can(ctx.role, "members.create") && (
              <LinkButton href={`/a/${academyId}/members/new`} icon="plus">
                Nouveau membre
              </LinkButton>
            )}
          </>
        }
      />
      <Notice searchParams={sp} />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
        <form method="get" action={`/a/${academyId}/members`} role="search" className="mb-3 flex w-full max-w-md items-end gap-2">
          {status !== "active" && <input type="hidden" name="status" value={status} />}
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-semibold">
              Rechercher
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Nom, prénom ou e-mail" maxLength={100} className="field" />
          </div>
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>
            <Icon name="search" size={18} />
            <span className="sr-only sm:not-sr-only">Rechercher</span>
          </button>
        </form>
        <TabNav label="Filtrer par statut" items={STATUS_TABS.map((t) => ({ href: hrefFor(1, t.value), label: t.label, current: t.value === status }))} />
      </div>

      {rows.length === 0 ? (
        q || status !== "active" ? (
          <EmptyState framed title="Aucun résultat" action={<LinkButton href={`/a/${academyId}/members`} variant="secondary">Effacer les filtres</LinkButton>}>
            Aucun membre ne correspond à ces critères.
          </EmptyState>
        ) : (
          <EmptyState
            framed
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
          <div className="hidden md:block">
            <DataTable caption="Liste des membres" headers={["Nom", "Dernière présence", "Inscription", "E-mail", ...(showStatus ? ["Statut"] : [])]}>
              {rows.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="px-4 py-1 font-semibold">
                    <Link href={`/a/${academyId}/members/${p.id}`} className="flex min-h-11 items-center no-underline hover:underline">
                      {p.lastName.toUpperCase()} {p.firstName}
                    </Link>
                  </th>
                  <td className="px-4 py-1">{p.lastAttendedAt ? formatDateTime(p.lastAttendedAt, tz) : <span className="text-ink-soft">Jamais</span>}</td>
                  <td className="px-4 py-1 text-ink-soft">{p.joinedOn ? formatCalendarDate(p.joinedOn) : "—"}</td>
                  <td className="max-w-64 truncate px-4 py-1 text-ink-soft">{p.email ?? "—"}</td>
                  {showStatus && <td className="px-4 py-1">{p.archivedAt ? <Badge>Archivé</Badge> : <Badge tone="success">Actif</Badge>}</td>}
                </tr>
              ))}
            </DataTable>
          </div>
          <ul className="divide-y divide-line rounded-sm border border-line bg-surface md:hidden">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/a/${academyId}/members/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 no-underline">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {p.lastName.toUpperCase()} {p.firstName}
                    </span>
                    <span className="block text-xs text-ink-soft">{p.lastAttendedAt ? `Dernière venue : ${formatDateTime(p.lastAttendedAt, tz)}` : "Jamais venu(e)"}</span>
                  </span>
                  {p.archivedAt ? <Badge>Archivé</Badge> : <Icon name="next" size={18} className="text-ink-soft" />}
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} hrefFor={(p) => hrefFor(p)} />
        </>
      )}
    </>
  );
}
