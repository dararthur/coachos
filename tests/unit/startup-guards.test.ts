import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

/**
 * Garde-fous STATIQUES de démarrage. Le comportement réel (processus qui s'arrête, port non exposé) est prouvé par
 * tests/e2e/startup-guards.spec.ts ; ce fichier échoue immédiatement si quelqu'un retire une protection du code.
 */
describe("démarrage de production : écoute locale imposée", () => {
  it("le script `start` précise l'adresse locale (-H 127.0.0.1) : jamais l'écoute sur toutes les interfaces", () => {
    expect(pkg.scripts.start).toMatch(/^next start\b.*(?:-H|--hostname)[ =]127\.0\.0\.1(?:\s|$)/);
    expect(pkg.scripts.start).not.toMatch(/0\.0\.0\.0|::/);
  });

  it("la pile e2e démarre aussi Next.js sur 127.0.0.1 explicitement", () => {
    const stack = read("tests/e2e/support/run-stack.mjs");
    expect(stack).toMatch(/"-H",\s*"127\.0\.0\.1"/);
    expect(stack).not.toMatch(/0\.0\.0\.0/);
  });

  it("aucun script du dépôt ne lance `next start` sans adresse", () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (/\bnext start\b/.test(cmd)) expect(cmd, name).toMatch(/(?:-H|--hostname)[ =]127\.0\.0\.1/);
    }
  });

  it("la configuration d'exemple de Nginx impose l'écrasement de X-Real-IP et ne propage pas X-Forwarded-For", () => {
    const nginx = read("ops/nginx-self-hosted.example.conf");
    expect(nginx).toMatch(/X-Real-IP\s+\$remote_addr/);
    expect(nginx).toMatch(/X-Forwarded-For\s+\$remote_addr/);
    expect(nginx).not.toMatch(/X-Forwarded-For\s+\$proxy_add_x_forwarded_for/); // la valeur qui AJOUTE l'IP fournie par le client
  });
});

describe("démarrage : la configuration est validée AVANT le premier appel métier", () => {
  it("src/instrumentation.ts valide l'environnement (hors phase de build) et délègue à une fonction qui arrête le processus", () => {
    const hook = read("src/instrumentation.ts");
    expect(hook).toMatch(/export async function register\(/);
    expect(hook).toMatch(/NEXT_RUNTIME !== "nodejs"/);
    expect(hook).toMatch(/phase-production-build/);
    // Lignes ACTIVES uniquement (un appel commenté ne protège rien) : début de ligne, mode multiligne.
    expect(hook).toMatch(/^\s*await validateConfigOrExit\(\);/m);
    const node = read("src/instrumentation-node.ts");
    expect(node).toMatch(/^\s*env\(\);/m);
    expect(node).toMatch(/^\s*process\.exit\(1\);/m);
  });

  it("la pile e2e déclare explicitement la configuration de test (APP_ENV=test), seule dérogation à l'interdiction d'outbox", () => {
    const stack = read("tests/e2e/support/run-stack.mjs");
    expect(stack).toMatch(/APP_ENV:\s*"test"/);
    expect(stack).toMatch(/MAIL_PROVIDER:\s*"outbox"/);
    // Le modèle de configuration ne déclare pas un environnement déployé avec la boîte d'envoi de test.
    expect(read(".env.example")).not.toMatch(/^APP_ENV=(production|staging)\s*$/m);
  });
});
