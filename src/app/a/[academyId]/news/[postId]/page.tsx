import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/domain/roles";
import { uuidField } from "@/domain/validation";
import { BackLink, Card, PageHeader } from "@/components/ui/ui";
import { ConfirmAction } from "@/components/ui/confirm";
import { deletePostAction, updatePostAction } from "@/server/actions/news";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { getPost } from "@/server/repositories/news";
import { PostForm } from "../post-form";

export const metadata: Metadata = { title: "Modifier la publication" };

export default async function EditPostPage({ params }: { params: Promise<{ academyId: string; postId: string }> }) {
  const { academyId, postId } = await params;
  const ctx = await requireAcademy(academyId, "news.manage", "news");
  if (!uuidField.safeParse(postId).success) notFound();
  const post = await inAcademy(ctx, (tx) => getPost(tx, academyId, postId));
  // Un coach n'accède qu'à ses propres publications.
  if (!post || !(can(ctx.role, "academy.update") || post.authorId === ctx.user.id)) notFound();

  return (
    <>
      <PageHeader title="Modifier la publication" back={<BackLink href={`/a/${academyId}/news`}>Actualités</BackLink>} />
      <div className="max-w-2xl space-y-6">
        <Card>
          <PostForm action={updatePostAction.bind(null, academyId, postId)} initial={{ title: post.title, body: post.body }} submitLabel="Enregistrer" />
        </Card>
        <Card title="Supprimer la publication" description="Elle disparaît pour tous les membres, définitivement.">
          <ConfirmAction
            action={deletePostAction.bind(null, academyId, postId)}
            trigger={<>Supprimer…</>}
            title="Supprimer cette publication ?"
            description="Les membres ne la verront plus. Cette action est définitive."
            confirmLabel="Supprimer définitivement"
          />
        </Card>
      </div>
    </>
  );
}
