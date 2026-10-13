import type { MetadataRoute } from "next";

/**
 * Manifeste PWA (installation sur l'écran d'accueil, mode standalone).
 * Volontairement SANS service worker : aucune donnée authentifiée n'est mise en cache hors ligne (voir docs/pwa.md).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Matnexa",
    short_name: "Matnexa",
    description: "Gestion de club : membres, planning, présences.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f2ee",
    theme_color: "#16191d",
    categories: ["sports", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
