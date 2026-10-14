import { inAcademy, resolveAcademy } from "@/server/auth/guards";
import { getSessionUser } from "@/server/auth/session";
import { getAcademyLogo } from "@/server/repositories/photos";

export const dynamic = "force-dynamic";

/** Logo du club, réservé à ses membres ; 404 pour tout autre cas (indiscernable d'un club sans logo). */
export async function GET(request: Request, { params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 404 });
  const ctx = await resolveAcademy(user, academyId);
  if (!ctx) return new Response(null, { status: 404 });
  const logo = await inAcademy(ctx, (tx) => getAcademyLogo(tx, academyId));
  if (!logo) return new Response(null, { status: 404 });
  const etag = `"${logo.updatedAt.getTime()}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(logo.data), { headers: { ...headers, "Content-Type": logo.contentType } });
}
