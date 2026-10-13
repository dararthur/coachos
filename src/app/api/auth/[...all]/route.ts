import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

// Better Auth gère les liens e-mail (vérification, réinitialisation) et les endpoints non remplacés par des Server Actions.
// Surface réduite (DISABLED_PATHS) et limites par action : voir src/server/auth/factory.ts.
export const dynamic = "force-dynamic";

/** Toute réponse de l'authentification (jetons dans les redirections, cookies de session) est interdite de cache, partout. */
async function noStore(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const GET = async (request: Request) => noStore(await toNextJsHandler(getAuth()).GET(request));
export const POST = async (request: Request) => noStore(await toNextJsHandler(getAuth()).POST(request));
