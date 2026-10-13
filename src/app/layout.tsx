import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Coach OS", template: "%s · Coach OS" },
  description: "Gestion de club pour le JJB, le grappling et le MMA : membres, planning, présences.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#134e4a" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Force le rendu dynamique : le nonce de la CSP (src/proxy.ts) doit être propre à chaque requête.
  await headers();
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
