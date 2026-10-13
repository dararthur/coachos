import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Coach OS", template: "%s · Coach OS" },
  description: "Gestion de club pour le JJB, le grappling et le MMA : membres, planning, présences.",
  robots: { index: false, follow: false },
  applicationName: "Coach OS",
  // iOS : ouverture en plein écran depuis l'écran d'accueil (le manifeste couvre Android/Chrome).
  appleWebApp: { capable: true, title: "Coach OS", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};

// viewport-fit=cover : plein écran sous l'encoche ; les marges de sécurité sont gérées en CSS (env(safe-area-inset-*)).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#134e4a" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Force le rendu dynamique : le nonce de la CSP (src/proxy.ts) doit être propre à chaque requête.
  await headers();
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
