import { Badge, Card } from "@/components/ui/ui";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { setRankingVisibilityAction } from "@/server/actions/members";

/** Choix « Apparaître dans le classement » : sur la page Classement et sur Mon profil, pour tout compte qui a une fiche. */
export function RankingVisibilityCard({ academyId, visible, className }: { academyId: string; visible: boolean; className?: string }) {
  return (
    <Card
      className={className}
      title="Ma visibilité dans le classement"
      description="Votre rang vous reste toujours visible. Vous choisissez si les autres membres du club voient aussi votre nom, votre photo et votre ceinture dans ce classement, avec votre nombre de venues ; vous pouvez changer d'avis à tout moment."
    >
      {visible ? (
        <ActionForm action={setRankingVisibilityAction.bind(null, academyId, false)}>
          <p className="mb-3 text-sm">
            <Badge tone="success">Visible</Badge> Votre nom, votre photo, votre ceinture et vos venues apparaissent dans le classement des autres membres.
          </p>
          <SubmitButton variant="secondary">Me retirer du classement des autres</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={setRankingVisibilityAction.bind(null, academyId, true)}>
          <p className="mb-3 text-sm">
            <Badge>Masqué</Badge> Les autres membres ne voient ni votre nom, ni votre photo, ni votre ceinture. Le coach, lui, voit les présences comme d&apos;habitude.
          </p>
          <SubmitButton>Apparaître dans le classement</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
