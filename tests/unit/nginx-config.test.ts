import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrôles STATIQUES de ops/nginx/. Ils ne remplacent PAS `nginx -t` (aucun binaire Nginx n'est disponible ici) : la validation de syntaxe
 * est faite par le job CI `nginx-syntax` (Docker), puis en préproduction sur le serveur. Ces tests protègent les EXIGENCES de sécurité.
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const conf = read("ops/nginx/coachos.conf");
const proxy = read("ops/nginx/proxy.inc");
const active = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
const cfg = active(conf);
const proxyCfg = active(proxy);

/** Corps de chaque bloc `nom { … }` de premier niveau et imbriqué (simple, suffisant pour ce fichier). */
function blocks(text: string, head: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(head)) {
    let depth = 0;
    let i = text.indexOf("{", m.index!);
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}" && --depth === 0) break;
    }
    out.push(text.slice(m.index!, i + 1));
    void start;
  }
  return out;
}

describe("ops/nginx : structure", () => {
  it("accolades et guillemets équilibrés ; chaque instruction se termine par ; ou un bloc", () => {
    expect([...cfg].filter((c) => c === "{").length).toBe([...cfg].filter((c) => c === "}").length);
    expect((cfg.match(/"/g) ?? []).length % 2).toBe(0);
    expect((cfg.match(/'/g) ?? []).length % 2).toBe(0);
    for (const line of cfg.split("\n")) expect(line, line).toMatch(/[;{}]$/);
    for (const line of proxyCfg.split("\n")) expect(line, line).toMatch(/;$/);
  });

  it("autonome : le fichier inclus existe, aucun autre include, un upstream nommé, deux serveurs (80 et 443)", () => {
    const includes = [...cfg.matchAll(/include\s+([^;]+);/g)].map((m) => m[1]);
    expect(new Set(includes)).toEqual(new Set(["/etc/nginx/coachos/proxy.inc"]));
    expect(existsSync(path.join(root, "ops/nginx/proxy.inc"))).toBe(true);
    expect(cfg).toMatch(/upstream\s+coachos_app\s*\{[^}]*server\s+127\.0\.0\.1:\d+;/);
    expect(blocks(cfg, /\bserver\s*\{/g)).toHaveLength(2);
    expect(cfg).toMatch(/listen\s+80;/);
    expect(cfg).toMatch(/listen\s+443\s+ssl;/);
    expect(cfg).toMatch(/return\s+301\s+https:\/\/\$host\$request_uri;/);
  });

  it("n'entre pas en collision avec d'autres applications : tout nom de niveau http est préfixé « coachos »", () => {
    for (const m of cfg.matchAll(/\b(?:log_format|upstream)\s+(\S+)/g)) expect(m[1], m[0]).toMatch(/^coachos/);
    for (const m of cfg.matchAll(/zone=(\w+):/g)) expect(m[1], m[0]).toMatch(/^coachos/);
    for (const m of cfg.matchAll(/limit_req_zone\s+\S+\s+zone=(\w+):/g)) expect(m[1]).toMatch(/^coachos/);
    expect(cfg).toMatch(/map\s+\$request_method\s+\$coachos_post_key/);
    expect(cfg).not.toMatch(/\bdefault_server\b/); // ne prend jamais le rôle de serveur par défaut du VPS
    expect(cfg).not.toMatch(/\blisten\s+[^;]*default_server/);
  });
});

describe("ops/nginx : sécurité exigée par l'application", () => {
  it("écrase X-Real-IP et X-Forwarded-For ; ne propage jamais la valeur du client ; ne transmet pas Forwarded", () => {
    expect(proxyCfg).toMatch(/proxy_set_header\s+X-Real-IP\s+\$remote_addr;/);
    expect(proxyCfg).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
    expect(proxyCfg).not.toMatch(/proxy_add_x_forwarded_for/);
    expect(proxyCfg).toMatch(/proxy_set_header\s+Forwarded\s+"";/);
    expect(proxyCfg).toMatch(/proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;/);
    expect(proxyCfg).toMatch(/proxy_set_header\s+Host\s+\$host;/);
    expect(cfg).not.toMatch(/proxy_set_header\s+X-(Real-IP|Forwarded-For)\s+\$http_/); // jamais lu depuis le client
  });

  it("n'émet AUCUN HSTS ni Cache-Control (émetteur unique : l'application) et configure aucun cache de proxy", () => {
    expect(cfg + proxyCfg).not.toMatch(/Strict-Transport-Security/i);
    expect(cfg + proxyCfg).not.toMatch(/\badd_header\b/);
    expect(cfg + proxyCfg).not.toMatch(/\bproxy_cache\w*\b/);
    expect(cfg + proxyCfg).not.toMatch(/\bexpires\b/);
  });

  it("TLS : TLS 1.2/1.3 seulement, pas de tickets de session, version du serveur masquée partout", () => {
    expect(cfg).toMatch(/ssl_protocols\s+TLSv1\.2\s+TLSv1\.3;/);
    expect(cfg).not.toMatch(/SSLv|TLSv1\.0|TLSv1\.1|TLSv1\s/);
    expect(cfg).toMatch(/ssl_session_tickets\s+off;/);
    for (const server of blocks(cfg, /\bserver\s*\{/g)) expect(server).toMatch(/server_tokens\s+off;/);
    expect(cfg).toMatch(/ssl_certificate\s+\S+;/);
    expect(cfg).toMatch(/ssl_certificate_key\s+\S+;/);
    expect(proxyCfg).toMatch(/proxy_hide_header\s+X-Powered-By;/);
  });

  it("renouvellement : défi ACME en webroot sur le port 80, sans modifier la configuration", () => {
    expect(cfg).toMatch(/location\s+\^~\s+\/\.well-known\/acme-challenge\/\s*\{[^}]*root\s+\/var\/www\/certbot;/);
  });

  it("journaux : format SANS chaîne de requête ; accès coupé là où le jeton est dans le CHEMIN ; aucun autre format utilisé", () => {
    const fmt = /log_format\s+coachos_notoken\s+([^;]+);/.exec(cfg)![1]!;
    for (const forbidden of ["$request_uri", "$args", "$query_string", "$request ", '$request"', "$http_referer", "$http_cookie", "$http_authorization", "$http_x_"]) {
      expect(fmt.includes(forbidden), forbidden).toBe(false);
    }
    expect(fmt).toContain("$uri");
    for (const m of cfg.matchAll(/access_log\s+(\/\S+)\s+(\S+);/g)) expect(m[2]).toBe("coachos_notoken");
    for (const tokenPath of ["/api/auth/reset-password/", "/invite/", "/checkin/"]) {
      const loc = blocks(cfg, new RegExp(`location\\s+\\^~\\s+${tokenPath.replace(/\//g, "\\/")}`, "g"))[0];
      expect(loc, tokenPath).toBeDefined();
      expect(loc, tokenPath).toMatch(/access_log\s+off;/);
    }
  });

  it("taille des requêtes, délais et limitation de débit explicites ; 429 plutôt que 503", () => {
    expect(cfg).toMatch(/client_max_body_size\s+3m;/);
    expect(cfg).toMatch(/client_header_timeout\s+\d+s;/);
    expect(cfg).toMatch(/client_body_timeout\s+\d+s;/);
    expect(proxyCfg).toMatch(/proxy_connect_timeout\s+\d+s;/);
    expect(proxyCfg).toMatch(/proxy_read_timeout\s+\d+s;/);
    expect(cfg).toMatch(/limit_req_status\s+429;/);
    expect(cfg).toMatch(/limit_req\s+zone=coachos_post\s+burst=\d+/);
    expect(cfg).toMatch(/limit_req\s+zone=coachos_links\s+burst=\d+/);
    // Seuls les POST sont comptés dans la zone des formulaires (clé vide pour les autres méthodes).
    expect(cfg).toMatch(/default\s+"";/);
  });

  it("la purge de rétention n'est joignable que depuis la machine elle-même", () => {
    const purge = blocks(cfg, /location\s+=\s+\/api\/cron\/purge\s*\{/g)[0]!;
    expect(purge).toMatch(/allow\s+127\.0\.0\.1;/);
    expect(purge).toMatch(/allow\s+::1;/);
    expect(purge).toMatch(/deny\s+all;/);
    expect(purge.indexOf("deny all")).toBeGreaterThan(purge.indexOf("allow 127.0.0.1"));
  });

  it("toute `location` transmet via proxy.inc, sauf le défi ACME et la redirection", () => {
    for (const loc of blocks(cfg, /\blocation\s+[^{]*\{/g)) {
      if (/acme-challenge/.test(loc) || /return\s+301/.test(loc)) continue;
      expect(loc, loc.slice(0, 60)).toMatch(/include\s+\/etc\/nginx\/coachos\/proxy\.inc;/);
    }
  });

  it("les placeholders sont explicites (domaine .invalid, port à choisir) : jamais de valeur réelle versionnée", () => {
    expect(conf).toMatch(/coachos\.example\.invalid/);
    expect(conf).toMatch(/PLACEHOLDER/);
    expect(conf).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b(?<!127\.0\.0\.1)/);
  });
});
