// Génère les icônes PWA (PNG) sans dépendance native : `node scripts/generate-icons.mjs`.
// Motif : anneau + coche blanche sur le vert du produit. Résultat déterministe, versionné dans public/icons/.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BG = [0x13, 0x4e, 0x4a]; // brand-800
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** @param glyphScale 1 = plein cadre ; 0.62 = tient dans la zone de sécurité « maskable » (80 % central). */
function render(size, { rounded, glyphScale }) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + 0.5) / SS) / size - 0.5; // [-0.5, 0.5]
        const v = (y + (sy + 0.5) / SS) / size - 0.5;
        let inside = true;
        if (rounded) {
          const r = 0.22, qx = Math.max(Math.abs(u) - (0.5 - r), 0), qy = Math.max(Math.abs(v) - (0.5 - r), 0);
          inside = Math.hypot(qx, qy) <= r;
        }
        if (!inside) continue;
        bg++;
        const gx = u / glyphScale, gy = v / glyphScale;
        const rad = Math.hypot(gx, gy);
        const ring = rad <= 0.36 && rad >= 0.29;
        const w = 0.045;
        const check = distToSegment(gx, gy, -0.15, 0.01, -0.04, 0.12) <= w || distToSegment(gx, gy, -0.04, 0.12, 0.17, -0.12) <= w;
        if (ring || check) fg++;
      }
      const i = (y * size + x) * 4;
      const total = SS * SS;
      const a = bg / total;
      const f = bg ? fg / bg : 0;
      out[i] = Math.round(BG[0] * (1 - f) + FG[0] * f);
      out[i + 1] = Math.round(BG[1] * (1 - f) + FG[1] * f);
      out[i + 2] = Math.round(BG[2] * (1 - f) + FG[2] * f);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, out);
}

const dir = path.resolve(import.meta.dirname, "../public/icons");
mkdirSync(dir, { recursive: true });
const files = {
  "icon-192.png": render(192, { rounded: true, glyphScale: 1.1 }),
  "icon-512.png": render(512, { rounded: true, glyphScale: 1.1 }),
  "icon-maskable-512.png": render(512, { rounded: false, glyphScale: 0.95 }),
  "apple-touch-icon.png": render(180, { rounded: false, glyphScale: 1.15 }),
};
for (const [name, data] of Object.entries(files)) writeFileSync(path.join(dir, name), data);
console.log(`Icônes générées dans ${dir} : ${Object.keys(files).join(", ")}`);
