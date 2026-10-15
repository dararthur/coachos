// Aperçu local de la vitrine statique (site/) avec les mêmes règles que Nginx en production (ops/nginx/matnexa-www.conf) :
// index de dossier, 404.html, et la même Content-Security-Policy, pour repérer toute violation avant le déploiement.
// Usage : node scripts/serve-site.mjs [port]   (défaut 4321, écoute sur 127.0.0.1 uniquement)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const port = Number(process.argv[2] ?? 4321);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Copie exacte de l'en-tête posé par ops/nginx/matnexa-www.conf.
const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const full = path.join(root, clean);
  if (!full.startsWith(root)) return null;
  try {
    const s = await stat(full);
    if (s.isDirectory()) {
      if (!urlPath.endsWith("/")) return { redirect: `${urlPath}/` };
      return { file: path.join(full, "index.html") };
    }
    return { file: full };
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" };
  const hit = await resolve(url.pathname);
  if (hit?.redirect) {
    res.writeHead(301, { ...headers, Location: hit.redirect });
    return res.end();
  }
  try {
    if (!hit) throw new Error("absent");
    const body = await readFile(hit.file);
    res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(hit.file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    const body = await readFile(path.join(root, "404.html"));
    res.writeHead(404, { ...headers, "Content-Type": TYPES[".html"] });
    res.end(body);
  }
}).listen(port, "127.0.0.1", () => console.log(`Vitrine : http://127.0.0.1:${port}/`));
