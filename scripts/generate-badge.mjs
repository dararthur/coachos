// Génère public/icons/badge-96.png : icône monochrome (blanc sur transparent) de la barre d'état Android pour les notifications.
// Android n'utilise que la transparence : une icône en couleur s'afficherait en carré uni. `node scripts/generate-badge.mjs`
import sharp from "sharp";
import path from "node:path";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3.5 3.5 25 25">
  <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
    <rect width="32" height="32" fill="#000"/>
    <g fill="#fff">
      <rect x="7.25" y="6" width="2.5" height="20" rx="0.8"/>
      <rect x="12.25" y="6" width="2.5" height="20" rx="0.8"/>
      <rect x="17.25" y="6" width="2.5" height="20" rx="0.8"/>
      <rect x="22.25" y="6" width="2.5" height="20" rx="0.8"/>
    </g>
    <path d="M4 23.5 28 8.5" stroke="#000" stroke-width="7.5"/>
    <path d="M4 23.5 28 8.5" stroke="#fff" stroke-width="3.4"/>
  </mask>
  <rect width="32" height="32" fill="#fff" mask="url(#m)"/>
</svg>`;

const out = path.join(import.meta.dirname, "..", "public", "icons", "badge-96.png");
await sharp(Buffer.from(svg), { density: 600 }).resize(96, 96).png({ compressionLevel: 9 }).toFile(out);
console.log(out);
