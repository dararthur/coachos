import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

// Archivo (Omnibus-Type, licence OFL : ./fonts/OFL-Archivo.txt), variable en graisse et en chasse, sous-ensemble latin
// auto-hébergé : aucune requête externe, compatible avec la CSP (font-src 'self').
const archivo = localFont({
  src: "./fonts/archivo-latin-var.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

export const metadata: Metadata = {
  title: { default: "Matnexa", template: "%s · Matnexa" },
  description: "Gestion de club pour le JJB, le grappling et le MMA : membres, planning, présences.",
  robots: { index: false, follow: false },
  applicationName: "Matnexa",
  // iOS : ouverture en plein écran depuis l'écran d'accueil (le manifeste couvre Android/Chrome).
  appleWebApp: { capable: true, title: "Matnexa", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// viewport-fit=cover : plein écran sous l'encoche ; les marges de sécurité sont gérées en CSS (env(safe-area-inset-*)).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#16191d" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Force le rendu dynamique : le nonce de la CSP (src/proxy.ts) doit être propre à chaque requête.
  await headers();
  return (
    <html lang="fr" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
