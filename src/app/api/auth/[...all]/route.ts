import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

// Better Auth gère les liens e-mail (vérification, réinitialisation) et les endpoints non remplacés par des Server Actions.
// Surface réduite (DISABLED_PATHS) et limites par action : voir src/server/auth/factory.ts.
export const dynamic = "force-dynamic";
export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request);
