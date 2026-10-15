import type { Metadata } from "next";
import { localDate } from "@/domain/dates";
import { can } from "@/domain/roles";
import { ordinal, parseRankingPeriod, RANKING_LABELS, RANKING_PERIODS, rankingRange } from "@/domain/ranking";
import { Avatar } from "@/components/ui/avatar";
import { BeltIcon } from "@/components/ui/belt";
import { Alert, Badge, Card, DataTable, EmptyState, PageHeader, Stat, StatGrid, TabNav } from "@/components/ui/ui";
import { RankingVisibilityCard } from "@/components/ui/ranking-visibility";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { attendanceRanking, myRankingVisibility } from "@/server/repositories/ranking";

export const metadata: Metadata = { title: "Classement" };

/** Classement des venues (présent ou en retard) sur la semaine, le mois ou l'année en cours. */
export default async function RankingPage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { academyId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId);
  const staff = can(ctx.role, "reports.read");
  const period = parseRankingPeriod(sp.periode);
  const { from, to } = rankingRange(period, localDate(new Date(), ctx.academy.timezone));
  const { rows, visible } = await inAcademy(ctx, async (tx) => ({
    rows: await attendanceRanking(tx, academyId, from, to),
    visible: await myRankingVisibility(tx, academyId),
  }));
  const me = rows.find((r) => r.isMe);
  const total = rows[0]?.rankedTotal ?? 0;
  // Rangs partagés (classement « 1, 2, 2, 4 ») : dit « ex æquo » plutôt que de laisser dix lignes « 4e » sans explication.
  const perRank = new Map<number, number>();
  for (const r of rows) if (r.rank !== null && r.visits > 0) perRank.set(r.rank, (perRank.get(r.rank) ?? 0) + 1);
  const tied = (rank: number | null) => rank !== null && (perRank.get(rank) ?? 0) > 1;
  const base = `/a/${academyId}/ranking`;

  return (
    <>
      <PageHeader
        title="Classement"
        description={staff ? "Tous les membres, classés par nombre de venues (présent ou en retard)." : "Classé par nombre de venues (présent ou en retard). Seuls les membres qui l'ont accepté apparaissent."}
      />
      <div className="mb-6 border-b border-line">
        <TabNav
          label="Période du classement"
          items={RANKING_PERIODS.map((p) => ({ href: `${base}?periode=${p}`, label: RANKING_LABELS[p], current: p === period }))}
        />
      </div>

      {!staff && (
        <StatGrid cols={2} className="mb-6">
          <Stat
            label="Mon rang"
            value={me?.rank ? ordinal(me.rank) : "—"}
            hint={me?.rank ? `${tied(me.rank) ? "ex æquo, " : ""}sur ${total} membre${total > 1 ? "s" : ""} venu${total > 1 ? "s" : ""}` : "Aucune venue sur la période"}
          />
          <Stat label="Mes venues" value={me?.visits ?? 0} />
        </StatGrid>
      )}

      {visible !== null && <RankingVisibilityCard academyId={academyId} visible={visible} className="mb-6" />}
      <Card title={RANKING_LABELS[period]} flush className="mb-6">
        {rows.filter((r) => r.visits > 0).length === 0 ? (
          <EmptyState level={3} title="Aucune venue sur cette période">Le classement se remplira dès les prochains appels.</EmptyState>
        ) : (
          <DataTable bare caption={`Classement ${RANKING_LABELS[period].toLowerCase()}`} headers={["Rang", "Membre", "Venues"]} numeric={[2]}>
            {rows.filter((r) => r.visits > 0).map((r) => (
              <tr key={r.personId} className={r.isMe ? "bg-accent-soft/40" : undefined}>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="font-bold">{r.rank ? ordinal(r.rank) : "—"}</span>
                  {tied(r.rank) && <span className="block text-xs text-ink-soft">ex æquo</span>}
                </td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-3">
                    <Avatar academyId={academyId} personId={r.personId} avatarStyle={r.avatarStyle} hasPhoto={r.hasPhoto} size="sm" />
                    <span className="min-w-0">
                      <span className="block">
                        {r.firstName} {r.lastName} {r.isMe && <Badge tone="brand">Vous</Badge>}
                      </span>
                      {r.belt && <BeltIcon belt={r.belt} stripes={r.beltStripes} size="sm" />}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold">{r.visits}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      {!staff && visible === null && <Alert tone="info">Votre fiche n&apos;est pas active dans ce club : contactez le coach.</Alert>}
      {staff && <Alert tone="info">Les membres choisissent eux-mêmes d&apos;apparaître ou non dans le classement des autres ; vous les voyez tous ici.</Alert>}
    </>
  );
}
