import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminFrame } from "@/components/layout/admin-frame";
import { InlineAction } from "@/components/ui/confirm";
import { Alert, BackLink, Badge, Card, PageHeader, Stat, StatGrid } from "@/components/ui/ui";
import { clubAlerts, lastThirteenMonths } from "@/domain/club-alerts";
import { formatDateTime } from "@/domain/dates";
import { FEATURE_IDS, FEATURES } from "@/domain/features";
import { setClubFeatureAction } from "@/server/actions/platform";
import { requirePlatformAdmin } from "@/server/auth/platform-admin";
import { withUser } from "@/server/db/client";
import { clubFeatures } from "@/server/repositories/features";
import { platformClubs, usageSeries } from "@/server/repositories/platform";
import { UsageChart } from "../../usage-chart";
import { z } from "zod";

export const metadata: Metadata = { title: "Club", robots: { index: false } };

/** Réglage des modules d'un club. Réservé à l'administrateur de la plateforme (404 pour tout autre compte). */
export default async function AdminClubPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  if (!z.uuid().safeParse(academyId).success) notFound();
  const user = await requirePlatformAdmin(`/admin/clubs/${academyId}`);
  const { club, states, series } = await withUser(user, async (tx) => ({
    series: await usageSeries(tx, academyId),
    club: (await platformClubs(tx)).find((c) => c.id === academyId) ?? null,
    states: await clubFeatures(tx, academyId),
  }));
  if (!club) notFound();
  const enabled = new Map(states.map((s) => [s.feature, s.enabled]));
  const now = new Date();
  const alerts = clubAlerts(club, now);
  return (
    <AdminFrame current="overview">
      <PageHeader
        back={<BackLink href="/admin">Tous les clubs</BackLink>}
        title={club.name}
        description={`Créé le ${formatDateTime(club.createdAt, "Europe/Paris").split(" ")[0]} · contact ${club.ownerEmail ?? "inconnu"}`}
      />

      {alerts.map((a) => (
        <Alert key={a.kind} tone={a.level === "danger" ? "danger" : "warning"} title="À surveiller">
          {a.text}
        </Alert>
      ))}

      <StatGrid className="my-6">
        <Stat label="Membres actifs" value={club.members} hint={`${club.staff} dans l'équipe`} />
        <Stat label="Séances (30 j)" value={club.sessions30d} />
        <Stat label="Usage (7 j)" value={club.events7d} hint={`${club.events30d} sur 30 jours`} />
        <Stat label="Dernier usage" value={club.lastEventAt ? formatDateTime(club.lastEventAt, club.timezone).split(" ")[0] : "Jamais"} />
      </StatGrid>

      <Card className="mb-6" title="Usage par mois" description="13 derniers mois : pointages par QR, réservations et feuilles d'appel. Le mois en cours est incomplet.">
        <UsageChart points={lastThirteenMonths(series, now)} />
      </Card>

      <Card title="Fonctionnalités" description="Un module coupé disparaît de la navigation du club et est refusé par le serveur et par la base. Les données déjà saisies sont conservées. Le club voit la modification dans son journal d'activité.">
        <ul className="divide-y divide-line">
          {FEATURE_IDS.map((f) => {
            const on = enabled.get(f) !== false;
            return (
              <li key={f} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0" data-testid={`feature-${f}`}>
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {FEATURES[f].label}
                    <Badge tone={on ? "success" : "warning"}>{on ? "Activé" : "Coupé"}</Badge>
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">{FEATURES[f].covers}</p>
                </div>
                <InlineAction
                  action={setClubFeatureAction.bind(null, academyId, f, !on)}
                  label={on ? "Couper" : "Activer"}
                  pendingLabel={on ? "Coupure…" : "Activation…"}
                  variant={on ? "secondary" : "primary"}
                />
              </li>
            );
          })}
        </ul>
      </Card>
    </AdminFrame>
  );
}
