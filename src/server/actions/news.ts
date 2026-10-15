"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError, type ActionResult } from "@/domain/errors";
import { clubPostSchema, uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import * as news from "@/server/repositories/news";
import { notifyNewsAfterResponse } from "@/server/push";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

export async function createPostAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("createPost", async () => {
    const ctx = await authorizeAcademy(academyId, "news.manage");
    const input = parseForm(clubPostSchema, formData);
    await inAcademy(ctx, (tx) => news.createPost(tx, academyId, input));
    if (formData.get("notify") === "on") notifyNewsAfterResponse({ academyId, academyName: ctx.academy.name, title: input.title, authorId: ctx.user.id });
    revalidatePath(`/a/${academyId}/news`);
    redirect(`/a/${academyId}/news?published=1`);
  });
}

export async function updatePostAction(academyId: string, postId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updatePost", async () => {
    const ctx = await authorizeAcademy(academyId, "news.manage");
    const id = uuidField.safeParse(postId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(clubPostSchema, formData);
    // La RLS limite un coach à ses propres publications : aucune ligne touchée = introuvable ou non autorisé.
    if (!(await inAcademy(ctx, (tx) => news.updatePost(tx, academyId, id.data, input)))) throw new AppError("forbidden");
    revalidatePath(`/a/${academyId}/news`);
    redirect(`/a/${academyId}/news?updated=1`);
  });
}

export async function deletePostAction(academyId: string, postId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("deletePost", async () => {
    const ctx = await authorizeAcademy(academyId, "news.manage");
    const id = uuidField.safeParse(postId);
    if (!id.success) throw new AppError("not_found");
    if (!(await inAcademy(ctx, (tx) => news.deletePost(tx, academyId, id.data)))) throw new AppError("forbidden");
    revalidatePath(`/a/${academyId}/news`);
    redirect(`/a/${academyId}/news?deleted=1`);
  });
}
