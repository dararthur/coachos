import type { NextConfig } from "next";

// En-têtes de sécurité statiques. La CSP (avec nonce) est posée par src/proxy.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions-Policy : posé par src/proxy.ts (la caméra n'est autorisée que sur /checkin).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Strict-Transport-Security : émis par src/proxy.ts (instance déployée en https seulement, sans includeSubDomains ni preload).
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Photo ou logo jusqu'à 2 Mo et import CSV de 1 Mo côté domaine ; marge pour l'enveloppe multipart (Nginx : 3m, ops/nginx/coachos.conf).
    serverActions: { bodySizeLimit: "3mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
