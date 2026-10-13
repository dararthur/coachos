import { expect, test } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Preuves de comportement RÉEL du démarrage de production (processus Next.js lancés pour de vrai, build requis) :
 *  - une configuration interdite, absente ou incohérente arrête le processus (code ≠ 0) avant d'écouter ;
 *  - la boîte d'envoi d'e-mails de test n'est jamais créée dans ces cas ;
 *  - `npm run start` n'écoute que sur 127.0.0.1 : l'adresse réseau de la machine refuse la connexion.
 * Aucune base de données ni service externe n'est contacté : la validation échoue (ou le serveur démarre) sans connexion.
 */
const root = path.resolve(import.meta.dirname, "../..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const rand = () => randomBytes(24).toString("hex");

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

/** Environnement du processus : TOUTES les variables pilotées sont fixées explicitement (le fichier .env éventuel ne passe jamais devant). */
function configEnv(over: Record<string, string>, outbox: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: "",
    SITE_URL: "",
    MAIL_PROVIDER: "",
    RESEND_API_KEY: "",
    MAIL_FROM: "",
    CRON_SECRET: "",
    CHECKIN_TOKEN_TTL_SECONDS: "",
    MAIL_OUTBOX_FILE: outbox,
    DATABASE_URL: `postgresql://app_server:${rand()}@127.0.0.1:5432/coachos`,
    AUTH_DATABASE_URL: `postgresql://auth_runtime:${rand()}@127.0.0.1:5432/coachos`,
    APP_SECRET: rand(),
    BETTER_AUTH_SECRET: rand(),
    ...over,
  };
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill("SIGKILL");
}

const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host, port, timeout: 3000 });
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("timeout", () => (s.destroy(), resolve(false)));
    s.on("error", () => resolve(false));
  });

async function waitForHealth(port: number, ms = 45_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Lance `next start` et attend sa fin (démarrage refusé attendu). */
function runUntilExit(env: NodeJS.ProcessEnv, port: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: root, env });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => (killTree(child), resolve({ code: null, output })), 40_000); // null = le processus ne s'est PAS arrêté
    child.on("exit", (code) => (clearTimeout(timer), resolve({ code, output })));
  });
}

const FORBIDDEN: { name: string; env: Record<string, string>; reason: RegExp }[] = [
  { name: "production + outbox", env: { APP_ENV: "production", SITE_URL: "https://coach.example.invalid", MAIL_PROVIDER: "outbox" }, reason: /outbox.*interdit.*APP_ENV=production/ },
  { name: "staging + outbox", env: { APP_ENV: "staging", SITE_URL: "https://coach.example.invalid", MAIL_PROVIDER: "outbox" }, reason: /outbox.*interdit.*APP_ENV=staging/ },
  { name: "APP_ENV=test mais SITE_URL publique + outbox", env: { APP_ENV: "test", SITE_URL: "https://coach.example.invalid", MAIL_PROVIDER: "outbox" }, reason: /SITE_URL locale/ },
  { name: "APP_ENV=development mais SITE_URL publique + outbox", env: { APP_ENV: "development", SITE_URL: "http://203.0.113.10:3000", MAIL_PROVIDER: "outbox" }, reason: /SITE_URL locale/ },
  { name: "APP_ENV absent", env: { SITE_URL: "http://127.0.0.1:3555", MAIL_PROVIDER: "outbox" }, reason: /APP_ENV/ },
  { name: "APP_ENV inconnu", env: { APP_ENV: "prod", SITE_URL: "http://127.0.0.1:3555", MAIL_PROVIDER: "outbox" }, reason: /APP_ENV/ },
  { name: "production + resend sans clé ni expéditeur", env: { APP_ENV: "production", SITE_URL: "https://coach.example.invalid", MAIL_PROVIDER: "resend" }, reason: /RESEND_API_KEY.*MAIL_FROM/ },
  { name: "production en http", env: { APP_ENV: "production", SITE_URL: "http://coach.example.invalid", MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_cle_factice_inutilisee", MAIL_FROM: "Coach OS <x@coach.example.invalid>" }, reason: /https obligatoire/ },
  { name: "configuration entièrement absente", env: { DATABASE_URL: "", AUTH_DATABASE_URL: "", APP_SECRET: "", BETTER_AUTH_SECRET: "" }, reason: /DATABASE_URL.*APP_SECRET|APP_SECRET.*DATABASE_URL|APP_ENV/ },
];

test.describe("démarrage de production : configuration interdite", () => {
  for (const c of FORBIDDEN) {
    test(`refus de démarrer : ${c.name}`, async () => {
      test.setTimeout(60_000);
      const outbox = path.join(os.tmpdir(), `coachos-startup-${rand().slice(0, 8)}.jsonl`);
      const port = await freePort();
      const env = configEnv(c.env, outbox);
      const { code, output } = await runUntilExit(env, port);
      expect(code, `le processus doit s'arrêter (null = encore vivant)\n${output.slice(-600)}`).toBe(1);
      expect(output).toMatch(/DÉMARRAGE REFUSÉ/);
      expect(output).toMatch(c.reason);
      for (const secret of [env.APP_SECRET, env.BETTER_AUTH_SECRET, env.RESEND_API_KEY, env.DATABASE_URL, env.AUTH_DATABASE_URL]) {
        if (secret) expect(output.includes(secret), "une valeur de configuration apparaît dans la sortie").toBe(false);
      }
      expect(await canConnect("127.0.0.1", port), "aucun port ne doit rester ouvert").toBe(false);
      expect(existsSync(outbox), "aucun fichier de boîte d'envoi ne doit être créé").toBe(false);
    });
  }
});

test.describe("démarrage de production : écoute locale uniquement", () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  test("`npm run start` (configuration de test autorisée) répond en local et REFUSE la connexion sur l'adresse réseau de la machine", async () => {
    test.skip(lan.length === 0, "aucune interface réseau non locale sur cette machine : le contrôle d'exposition n'a pas de sens");
    test.setTimeout(120_000);
    const port = await freePort();
    const outbox = path.join(os.tmpdir(), `coachos-startup-${rand().slice(0, 8)}.jsonl`);
    const env = configEnv({ APP_ENV: "test", SITE_URL: `http://127.0.0.1:${port}`, MAIL_PROVIDER: "outbox" }, outbox);
    // Le VRAI script de package.json (celui qu'un service systemd lancerait), avec seulement le port ajouté.
    const child = spawn(`npm run start -- -p ${port}`, { cwd: root, env, shell: true });
    try {
      expect(await waitForHealth(port), "le serveur de test autorisé doit démarrer").toBe(true);
      expect(await canConnect("127.0.0.1", port)).toBe(true);
      for (const address of lan) expect(await canConnect(address, port), `${address}:${port} ne doit pas être joignable`).toBe(false);
    } finally {
      killTree(child);
      rmSync(outbox, { force: true });
    }
  });

  test("contrôle de sensibilité : avec -H 0.0.0.0, la même sonde RETROUVE l'exposition (le test ci-dessus n'est pas vacueux)", async () => {
    test.skip(lan.length === 0, "aucune interface réseau non locale sur cette machine");
    test.setTimeout(120_000);
    const port = await freePort();
    const outbox = path.join(os.tmpdir(), `coachos-startup-${rand().slice(0, 8)}.jsonl`);
    const env = configEnv({ APP_ENV: "test", SITE_URL: `http://127.0.0.1:${port}`, MAIL_PROVIDER: "outbox" }, outbox);
    const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", String(port)], { cwd: root, env });
    try {
      expect(await waitForHealth(port)).toBe(true);
      expect(await canConnect(lan[0]!, port), "sans -H 127.0.0.1 le serveur serait joignable depuis le réseau").toBe(true);
    } finally {
      killTree(child);
      rmSync(outbox, { force: true });
    }
  });
});
