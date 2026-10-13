import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { env } from "@/server/env";

/** Client Supabase Auth lié aux cookies de la requête (session HttpOnly gérée par @supabase/ssr). */
export async function createAuthClient() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(e.SUPABASE_URL, e.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Appel depuis un Server Component : le rafraîchissement est fait par src/proxy.ts.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  displayName: string;
}

/**
 * Utilisateur authentifié de la requête, vérifié auprès du serveur Supabase Auth (getUser) :
 * jamais déduit d'un cookie non vérifié. Mémorisé pour la durée de la requête.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const meta = data.user.user_metadata as { display_name?: unknown } | null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
    displayName: typeof meta?.display_name === "string" ? meta.display_name : "",
  };
});
