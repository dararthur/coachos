import type { Metadata } from "next";
import { formatDay } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Alert, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/ui";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listPosts } from "@/server/repositories/news";

export const metadata: Metadata = { title: "Actualités" };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Actualités du club : tous les membres lisent, l'équipe publie. */
export default async function NewsPage({ params, searchParams }: { params: Promise<{ academyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { academyId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId);
  const tz = ctx.academy.timezone;
  const posts = await inAcademy(ctx, (tx) => listPosts(tx, academyId));
  const staff = can(ctx.role, "news.manage");
  // Un coach ne modifie que ses publications ; un administrateur ou le propriétaire, toutes (la base applique la même règle).
  const canEdit = (authorId: string | null) => can(ctx.role, "academy.update") || authorId === ctx.user.id;

  return (
    <>
      <PageHeader
        title="Actualités"
        description={`Les nouvelles de « ${ctx.academy.name} ».`}
        actions={staff ? <LinkButton href={`/a/${academyId}/news/new`} icon="plus">Nouvelle publication</LinkButton> : undefined}
      />
      {sp.published && <Alert tone="success" title="Publication en ligne">Les membres du club peuvent la lire dès maintenant.</Alert>}
      {sp.updated && <Alert tone="success" title="Publication modifiée">Vos modifications sont visibles par les membres.</Alert>}
      {sp.deleted && <Alert tone="success" title="Publication supprimée">Elle n&apos;est plus visible.</Alert>}

      {posts.length === 0 ? (
        <EmptyState framed title="Aucune actualité pour le moment" action={staff ? <LinkButton href={`/a/${academyId}/news/new`}>Publier la première</LinkButton> : undefined}>
          {staff ? "Annoncez un changement d'horaire, un stage, une compétition : tous les membres du club le verront ici." : "Les annonces du club apparaîtront ici."}
        </EmptyState>
      ) : (
        <ul className="max-w-3xl space-y-4">
          {posts.map((p) => (
            <li key={p.id}>
              <Card
                title={p.title}
                description={`${capitalize(formatDay(p.createdAt, tz))}${p.updatedAt.getTime() - p.createdAt.getTime() > 60_000 ? " · modifié" : ""}`}
                actions={
                  staff && canEdit(p.authorId) ? (
                    <LinkButton href={`/a/${academyId}/news/${p.id}`} variant="secondary" icon="edit">
                      Modifier<span className="sr-only"> « {p.title} »</span>
                    </LinkButton>
                  ) : undefined
                }
              >
                <p className="max-w-[68ch] whitespace-pre-line break-words text-base">{p.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
