import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy Next.js (ex-middleware) : 1) rafraîchit la session Supabase (cookies HttpOnly),
 * 2) pose une Content-Security-Policy stricte avec nonce par requête.
 * L'autorisation fine n'est PAS faite ici : elle l'est dans chaque page/action (src/server/auth/guards.ts) et par la RLS.
 */
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'" + (isDev ? " ws: wss:" : ""),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          // Les réponses qui posent des cookies d'authentification ne doivent jamais être mises en cache partagé.
          for (const [header, value] of Object.entries(headers ?? {})) response.headers.set(header, value);
        },
      },
    });
    // Rafraîchit le jeton si nécessaire (et pose les nouveaux cookies). Ne pas insérer de code entre createServerClient et getUser.
    await supabase.auth.getUser();
  }

  response.headers.set("Content-Security-Policy", csp);
  // La caméra n'est autorisée que sur la page de scan ; micro, géolocalisation, paiement et USB ne le sont jamais.
  const camera = request.nextUrl.pathname === "/checkin" ? "camera=(self)" : "camera=()";
  response.headers.set("Permissions-Policy", `${camera}, microphone=(), geolocation=(), payment=(), usb=()`);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|icons/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
