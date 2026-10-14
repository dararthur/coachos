import { z } from "zod";
import { inAcademy, resolveAcademy } from "@/server/auth/guards";
import { getSessionUser } from "@/server/auth/session";
import { getPhoto } from "@/server/repositories/photos";

export const dynamic = "force-dynamic";

const uuid = z.uuid();

/** Photo d'une fiche. 404 pour tout ce que l'appelant n'a pas le droit de voir (indiscernable d'une photo absente). */
export async function GET(request: Request, { params }: { params: Promise<{ academyId: string; personId: string }> }) {
  const { academyId, personId } = await params;
  const user = await getSessionUser();
  if (!user || !uuid.safeParse(personId).success) return new Response(null, { status: 404 });
  const ctx = await resolveAcademy(user, academyId);
  if (!ctx) return new Response(null, { status: 404 });
  const photo = await inAcademy(ctx, (tx) => getPhoto(tx, academyId, personId));
  if (!photo) return new Response(null, { status: 404 });
  const etag = `"${photo.updatedAt.getTime()}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(photo.data), { headers: { ...headers, "Content-Type": photo.contentType } });
}
