import type { Metadata } from "next";
import Link from "next/link";
import { AdminFrame } from "@/components/layout/admin-frame";
import { Badge, Card, DataTable, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/ui";
import { formatDateTime } from "@/domain/dates";
import { FEATURES, isFeature } from "@/domain/features";
import { requirePlatformAdmin } from "@/server/auth/platform-admin";
import { withUser } from "@/server/db/client";
import { platformClubs, platformOverview } from "@/server/repositories/platform";

export const metadata: Metadata = { title: "Administration", robots: { index: false } };

const EVENT_LABELS: Record<string, string> = {
  checkin_qr: "Pointages par QR",
  booking_created: "Réservations",
  roll_validated: "Feuilles validées par un coach",
  roll_auto_closed: "Feuilles clôturées automatiquement",
};

const DAY = 24 * 60 * 60 * 1000;

function size(bytes: number): string {
  return bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(0)} Mo` : `${(bytes / 1024 ** 3).toFixed(1)} Go`;
}

/** Un club est « actif » s'il a enregistré de l'usage dans les 7 derniers jours, « calme » sur 30 jours, sinon « inactif ». */
function activity(events7d: number, events30d: number): { label: string; tone: "success" | "warning" | "neutral" } {
  if (events7d > 0) return { label: "Actif", tone: "success" };
  if (events30d > 0) return { label: "Calme", tone: "warning" };
  return { label: "Inactif", tone: "neutral" };
}

/** Réservé à l'administrateur de la plateforme : tout autre compte reçoit un 404. Compteurs uniquement, aucune donnée de membre. */
export default async function AdminPage() {
  const user = await requirePlatformAdmin("/admin");
  const { overview, clubs } = await withUser(user, async (tx) => ({ overview: await platformOverview(tx), clubs: await platformClubs(tx) }));
  const now = Date.now();
  return (
    <AdminFrame current="overview">
      <PageHeader title="Administration de la plateforme" description="Vue d'ensemble des clubs et de l'usage. Aucune donnée de membre n'est affichée ici : seulement des compteurs." />

      <StatGrid className="mb-6">
        <Stat label="Clubs" value={overview.clubs} hint={`${overview.activeClubs30d} avec de l'usage sur 30 jours`} />
        <Stat label="Membres actifs" value={overview.members} hint={`${overview.accounts} comptes`} />
        <Stat label="Usage sur 7 jours" value={overview.events7d} hint={`${overview.events30d} sur 30 jours`} />
        <Stat label="Demandes en attente" value={overview.pendingRequests} href="/admin/club-requests" />
      </StatGrid>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Usage sur 30 jours" description="Événements sans identifiant de personne, tous clubs confondus.">
          {Object.keys(overview.byEvent).length === 0 ? (
            <p className="text-sm text-ink-soft">Aucun usage enregistré sur la période.</p>
          ) : (
            <dl className="divide-y divide-line text-sm">
              {Object.entries(overview.byEvent).map(([event, n]) => (
                <div key={event} className="flex justify-between gap-3 py-2">
                  <dt>{EVENT_LABELS[event] ?? event}</dt>
                  <dd className="font-bold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        <Card title="Système" description="Base de données de la plateforme.">
          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt>Taille de la base</dt>
              <dd className="font-bold tabular-nums">{size(overview.dbSizeBytes)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt>PostgreSQL</dt>
              <dd className="font-bold tabular-nums">{overview.dbVersion}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-soft">La disponibilité du site et des tâches planifiées se surveille hors de l&apos;application (docs/monitoring.md).</p>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-bold">Clubs</h2>
      {clubs.length === 0 ? (
        <EmptyState framed title="Aucun club">
          Les clubs apparaissent ici dès qu&apos;une demande approuvée a été réclamée.
        </EmptyState>
      ) : (
        <DataTable caption="Liste des clubs" headers={["Club", "Activité", "Membres", "Équipe", "Séances (30 j)", "Usage (7 j)", "Dernier usage", "Modules coupés", "Contact", "Créé le"]} numeric={[2, 3, 4, 5]}>
          {clubs.map((c) => {
            const a = activity(c.events7d, c.events30d);
            const idle = c.lastEventAt ? Math.floor((now - c.lastEventAt.getTime()) / DAY) : null;
            return (
              <tr key={c.id} data-testid="platform-club">
                <th scope="row" className="px-4 py-3 text-left font-bold">
                  <Link href={`/admin/clubs/${c.id}`}>{c.name}</Link>
                </th>
                <td className="px-4 py-3">
                  <Badge tone={a.tone}>{a.label}</Badge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{c.members}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.staff}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.sessions30d}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.events7d}</td>
                <td className="px-4 py-3 whitespace-nowrap text-ink-soft">
                  {c.lastEventAt ? `${formatDateTime(c.lastEventAt, c.timezone)}${idle !== null && idle > 0 ? ` (il y a ${idle} j)` : ""}` : "Jamais"}
                </td>
                <td className="px-4 py-3 text-ink-soft">{c.disabledFeatures.filter(isFeature).map((f) => FEATURES[f].label).join(", ") || "Aucun"}</td>
                <td className="px-4 py-3 break-all text-ink-soft">{c.ownerEmail ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-ink-soft">{formatDateTime(c.createdAt, "Europe/Paris").split(" ")[0]}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </AdminFrame>
  );
}
