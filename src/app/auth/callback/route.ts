import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/server/actions/helpers";
import { createAuthClient } from "@/server/auth/supabase";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

/** Retour des liens e-mail Supabase (confirmation, réinitialisation) : échange le code PKCE contre une session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/");
  const base = env().SITE_URL;
  if (!code || code.length > 500) return NextResponse.redirect(new URL("/login?error=callback", base));
  const supabase = await createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logger.warn("auth.callback_failed", { status: error.status, code: error.code });
    return NextResponse.redirect(new URL("/login?error=callback", base));
  }
  return NextResponse.redirect(new URL(next, base));
}
