import type { Metadata } from "next";
import { BackLink, Card, PageHeader } from "@/components/ui/ui";
import { createPostAction } from "@/server/actions/news";
import { requireAcademy } from "@/server/auth/guards";
import { vapidPublicKey } from "@/server/push";
import { PostForm } from "../post-form";

export const metadata: Metadata = { title: "Nouvelle publication" };

export default async function NewPostPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  await requireAcademy(academyId, "news.manage");
  return (
    <>
      <PageHeader title="Nouvelle publication" back={<BackLink href={`/a/${academyId}/news`}>Actualités</BackLink>} />
      <Card className="max-w-2xl">
        <PostForm action={createPostAction.bind(null, academyId)} submitLabel="Publier" notify={vapidPublicKey() !== null} />
      </Card>
    </>
  );
}
