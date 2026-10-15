// Génère les images de la vitrine à partir de ses propres sources (aucun outil d'image externe) :
//   - site/assets/og-matnexa.png (1200 × 630, aperçu de partage) : rendu Chrome du cahier rayé de site/index.html ;
//   - site/favicon.ico : le symbole public/icons/icon.svg en 32 px, PNG encapsulé dans un conteneur ICO.
// Prérequis : l'aperçu local tourne (node scripts/serve-site.mjs), pour charger la police et la feuille de style.
// Usage : node scripts/build-site-og.mjs [http://127.0.0.1:4321/]
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const base = process.argv[2] ?? "http://127.0.0.1:4321/";
const html = readFileSync("site/index.html", "utf8");
const cut = (start, end) => {
  const i = html.indexOf(start);
  return html.slice(i, html.indexOf(end, i) + end.length);
};
const notebook = cut('<svg class="notebook"', "</svg>");
const mark = cut('<symbol id="mark"', "</symbol>");

const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><base href="${base}">
<link rel="stylesheet" href="assets/site.css"><style>
body{margin:0;width:1200px;height:630px;overflow:hidden;background:#f4f2ee}
.og{display:grid;grid-template-columns:520px 1fr;height:630px}
.l{background:#16191d;color:#fff;padding:60px 56px;display:flex;flex-direction:column;justify-content:space-between}
.l h1{font-size:104px;font-weight:750;font-stretch:72%;line-height:.9;letter-spacing:-.02em;margin:0}
.l p{font-size:26px;line-height:1.3;color:#a3a9b1;margin:0}
.r{display:grid;place-items:center;padding:40px}
.r svg.notebook{width:620px}
.lg{display:flex;align-items:center;gap:14px;font-size:34px;font-weight:700;font-stretch:87.5%;letter-spacing:-.015em}
.lg svg{width:44px;height:44px;border-radius:9px;box-shadow:0 0 0 1px rgb(255 255 255/.15)}
.strike-casing,.strike-tape{animation:none!important;stroke-dasharray:none!important;stroke-dashoffset:0!important}
</style></head><body><svg class="sr-only" aria-hidden="true">${mark}</svg><div class="og"><div class="l">
<div class="lg"><svg viewBox="0 0 32 32"><use href="#mark"/></svg>Matnexa</div>
<h1>Rayez le cahier d'appel.</h1>
<p>Gestion de club de JJB, grappling et MMA : appel, pointage QR, réservations.</p>
</div><div class="r">${notebook}</div></div></body></html>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
// bypassCSP : la CSP de l'aperçu interdit le style en ligne de cette page de rendu (jamais publiée).
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, bypassCSP: true });
// Même origine que l'aperçu : la police est chargée sans CORS.
await tab.goto(base);
await tab.setContent(page, { waitUntil: "networkidle" });
await tab.evaluate(() => document.fonts.ready);
const loaded = await tab.evaluate(() => document.fonts.check('700 40px "Archivo"'));
if (!loaded) throw new Error("Police Archivo non chargée : l'aperçu local tourne-t-il ?");
await tab.screenshot({ path: "site/assets/og-matnexa.png" });
await browser.close();

const png = await sharp("public/icons/icon.svg", { density: 300 }).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // réservé
header.writeUInt16LE(1, 2); // type : icône
header.writeUInt16LE(1, 4); // une image
header.writeUInt8(32, 6); // largeur
header.writeUInt8(32, 7); // hauteur
header.writeUInt16LE(1, 10); // plans
header.writeUInt16LE(32, 12); // bits par pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // décalage des données
writeFileSync("site/favicon.ico", Buffer.concat([header, png]));
console.log("site/assets/og-matnexa.png et site/favicon.ico écrits.");
