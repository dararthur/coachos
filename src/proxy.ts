import { NextResponse, type NextRequest } from "next/server";
import { hstsHeader } from "@/server/security-headers";

/**
 * Proxy Next.js (ex-middleware) : pose une Content-Security-Policy stricte avec nonce par requête.
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  // La caméra n'est autorisée que sur la page de scan ; micro, géolocalisation, paiement et USB ne le sont jamais.
  const camera = request.nextUrl.pathname === "/checkin" ? "camera=(self)" : "camera=()";
  response.headers.set("Permissions-Policy", `${camera}, microphone=(), geolocation=(), payment=(), usb=()`);
  // HSTS : émetteur unique (jamais Nginx). Lu à CHAQUE requête dans l'environnement d'exécution du service.
  const hsts = hstsHeader({ appEnv: process.env.APP_ENV, siteUrl: process.env.SITE_URL, maxAge: process.env.HSTS_MAX_AGE_SECONDS });
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);
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
