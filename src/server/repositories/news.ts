import "server-only";
import type { Tx } from "@/server/db/client";

export interface ClubPost {
  id: string;
  title: string;
  body: string;
  visibility: "members" | "public";
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}


export async function listPosts(tx: Tx, academyId: string, limit = 50): Promise<ClubPost[]> {
  return tx<ClubPost[]>`
    select id, title, body, visibility, author_id as "authorId", created_at as "createdAt", updated_at as "updatedAt"
    from public.club_posts where academy_id = ${academyId} order by created_at desc limit ${limit}`;
}

export async function getPost(tx: Tx, academyId: string, id: string): Promise<ClubPost | null> {
  const [row] = await tx<ClubPost[]>`
    select id, title, body, visibility, author_id as "authorId", created_at as "createdAt", updated_at as "updatedAt"
    from public.club_posts where academy_id = ${academyId} and id = ${id}`;
  return row ?? null;
}

/** Toujours « members » : le choix « public » n'est pas encore proposé (voir docs/news.md). */
export async function createPost(tx: Tx, academyId: string, i: { title: string; body: string }): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.club_posts (academy_id, title, body, visibility) values (${academyId}, ${i.title}, ${i.body}, 'members') returning id`;
  return row!.id;
}

/** false si la publication n'existe pas ou si la RLS refuse (coach qui n'en est pas l'auteur). */
export async function updatePost(tx: Tx, academyId: string, id: string, i: { title: string; body: string }): Promise<boolean> {
  const r = await tx`update public.club_posts set title = ${i.title}, body = ${i.body} where academy_id = ${academyId} and id = ${id}`;
  return r.count > 0;
}

export async function deletePost(tx: Tx, academyId: string, id: string): Promise<boolean> {
  const r = await tx`delete from public.club_posts where academy_id = ${academyId} and id = ${id}`;
  return r.count > 0;
}
