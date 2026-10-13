import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, planRetention } from "../../scripts/lib/backup-retention.mjs";

/**
 * Les scripts d'exploitation ne sont JAMAIS exécutés pour de vrai ici (ni pg_dump, ni age, ni rclone, ni systemctl) : on vérifie leur
 * logique avec de FAUX binaires placés en tête du PATH, et leurs garde-fous par analyse statique. Voir docs/operations.md.
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const sh = (p: string) => path.join(root, p).replace(/\\/g, "/");
const SCRIPTS = ["ops/backup/backup.sh", "ops/backup/prune.sh", "ops/backup/restore-verify.sh", "ops/release/activate.sh", "ops/release/rollback.sh"];

const bashOk = spawnSync("bash", ["-c", "command -v sha256sum >/dev/null && echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";
const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "coachos-ops-"));
  tmps.push(d);
  return d;
};
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fake(dir: string, name: string, body: string) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}
function run(script: string, args: string[], env: Record<string, string>, binDir?: string) {
  const sep = process.platform === "win32" ? ";" : ":";
  const r = spawnSync("bash", [sh(script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, PATH: binDir ? `${binDir}${sep}${process.env.PATH}` : process.env.PATH },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("rétention des sauvegardes (fonction pure)", () => {
  const name = (iso: string) => `coachos-${iso.replace(/[-:]/g, "").replace(/\.\d+/, "")}.dump.age`;
  const days = (n: number) => Array.from({ length: n }, (_, i) => name(new Date(Date.UTC(2026, 9, 13, 3, 30) - i * 86_400_000).toISOString()));

  it("garde 14 jours, puis 1 par semaine / par mois ; la plus récente n'est jamais supprimée", () => {
    const names = days(200);
    const plan = planRetention(names);
    expect(plan.keep).toContain(names[0]);
    expect(plan.keep.slice(0, 14)).toEqual(names.slice(0, 14));
    expect(plan.keep.length).toBeLessThan(14 + DEFAULT_POLICY.weekly + DEFAULT_POLICY.monthly + 1);
    expect(plan.delete.length + plan.keep.length).toBe(200);
    expect(plan.delete).toContain(names[100]);
  });

  it("ne désigne JAMAIS un fichier dont le nom n'est pas exactement celui d'une sauvegarde", () => {
    const plan = planRetention(["notes.txt", "coachos-20260101T000000Z.dump", "coachos-20260101T000000Z.dump.age.sha256", "autre.age", ...days(30)]);
    for (const other of ["notes.txt", "coachos-20260101T000000Z.dump", "coachos-20260101T000000Z.dump.age.sha256", "autre.age"]) {
      expect(plan.delete).not.toContain(other);
      expect(plan.keep).not.toContain(other);
    }
  });

  it("une seule sauvegarde peut exister : elle est conservée ; liste vide : rien à faire", () => {
    const one = [name("2026-10-13T03:30:00Z")];
    expect(planRetention(one)).toEqual({ keep: one, delete: [] });
    expect(planRetention([])).toEqual({ keep: [], delete: [] });
  });
});

describe("scripts d'exploitation : garde-fous statiques", () => {
  for (const s of SCRIPTS) {
    it(`${s} : mode strict, aucune suppression récursive, aucun secret affiché`, () => {
      const text = read(s);
      expect(text).toMatch(/^set -euo pipefail$/m);
      const active = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
      expect(active).not.toMatch(/\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*R|--recursive)/);
      expect(active).not.toMatch(/\bdrop\s+(database|schema|table)\b/i);
      expect(active).not.toMatch(/--force|--clean|--create/);
      expect(active).not.toMatch(/echo[^\n]*\$\{?(BACKUP_DATABASE_URL|RESTORE_ADMIN_URL|RESTORE_AGE_IDENTITY_FILE)/);
      expect(active).not.toMatch(/set -x|xtrace/);
    });
  }

  it("la restauration ne peut supprimer qu'une base « restore_check_* » créée par elle-même", () => {
    const text = read("ops/backup/restore-verify.sh");
    expect(text.match(/\bdropdb\b/g)).toHaveLength(2 + 1); // 1 vérification de présence + 1 appel + 1 mention dans le plan
    expect(text).toMatch(/CREATED=1/);
    expect(text).toMatch(/case "\$SCRATCH" in restore_check_\*\)/);
  });

  it("le retour applicatif ne supprime aucune version et ne touche pas à la base", () => {
    const active = (read("ops/release/activate.sh") + read("ops/release/rollback.sh")).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(active).not.toMatch(/\brm\b/);
    expect(active).not.toMatch(/migrate|psql|pg_restore|pg_dump/);
  });

  it("aucune clé privée age ni secret n'est versionné dans ops/", () => {
    for (const f of [...SCRIPTS, "ops/systemd/coachos-backup.service", "ops/systemd/coachos-backup.timer"]) expect(read(f)).not.toMatch(/AGE-SECRET-KEY-1[A-Z0-9]{20,}/);
  });
});

describe.skipIf(!bashOk)("backup.sh avec de FAUX binaires (aucune sauvegarde réelle)", () => {
  const DB_URL = "postgresql://backup_ro:pw@db.invalid:5432/coachos";
  function setup() {
    const dir = tmp();
    const bin = path.join(dir, "bin");
    const remote = path.join(dir, "remote");
    mkdirSync(bin);
    mkdirSync(remote);
    const recipients = path.join(dir, "recipients.txt");
    writeFileSync(recipients, "age1publiquefictif0000000000000000000000000000000000000000000\n");
    const log = path.join(dir, "calls.log").replace(/\\/g, "/");
    fake(bin, "pg_dump", `echo "pg_dump" >> "${log}"; for a in "$@"; do case "$a" in --file=*) printf 'DONNEES' > "\${a#--file=}";; esac; done`);
    fake(bin, "age", `echo "age" >> "${log}"; out=""; in=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -R) shift;; *) in="$1";; esac; shift; done; cat "$in" | tr 'A-Z' 'a-z' > "$out"`);
    fake(bin, "rclone", `echo "rclone $1" >> "${log}"; r="${remote.replace(/\\/g, "/")}"; case "$1" in copyto) cp "$2" "$r/$(basename "$3")";; cat) cat "$r/$(basename "$2")";; esac`);
    const env = { BACKUP_DATABASE_URL: DB_URL, BACKUP_AGE_RECIPIENTS_FILE: recipients.replace(/\\/g, "/"), BACKUP_REMOTE: "offsite:coachos", BACKUP_WORKDIR: path.join(dir, "work").replace(/\\/g, "/") };
    return { dir, bin, remote, env, log };
  }

  it("--dry-run : plan affiché, aucun binaire appelé, URL de base jamais affichée", () => {
    const s = setup();
    const r = run("ops/backup/backup.sh", ["--dry-run"], s.env, s.bin);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/plan \(rien n'est exécuté\)/);
    expect(r.out).not.toMatch(/backup_ro|db\.invalid/);
    expect(existsSync(s.log)).toBe(false);
  });

  it("exécution complète : fichier en clair supprimé, somme écrite, copie distante vérifiée, aucun secret dans la sortie", () => {
    const s = setup();
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toMatch(/backup_ro|db\.invalid/);
    const work = readdirSync(path.join(s.dir, "work"));
    expect(work.filter((f) => f.endsWith(".dump")), "aucun fichier en clair ne doit subsister").toEqual([]);
    expect(work.some((f) => f.endsWith(".dump.age"))).toBe(true);
    expect(work.some((f) => f.endsWith(".dump.age.sha256"))).toBe(true);
    expect(readdirSync(s.remote).sort()).toEqual(work.sort());
  });

  it("refuse une clé PRIVÉE age dans le fichier de destinataires, avant toute sauvegarde", () => {
    const s = setup();
    writeFileSync(s.env.BACKUP_AGE_RECIPIENTS_FILE, "AGE-SECRET-KEY-1FICTIVE\n");
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/clé PRIVÉE/);
    expect(existsSync(s.log)).toBe(false);
  });

  it("copie distante différente de la locale : échec explicite (code 4)", () => {
    const s = setup();
    fake(s.bin, "rclone", `case "$1" in copyto) cp "$2" "${s.remote.replace(/\\/g, "/")}/$(basename "$3")";; cat) echo corrompu;; esac`);
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/diffère/);
  });

  it("échec de pg_dump : le fichier en clair éventuel est supprimé et rien n'est envoyé", () => {
    const s = setup();
    fake(s.bin, "pg_dump", `for a in "$@"; do case "$a" in --file=*) printf 'PARTIEL' > "\${a#--file=}";; esac; done; exit 1`);
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code).not.toBe(0);
    expect(readdirSync(path.join(s.dir, "work"))).toEqual([]);
    expect(readdirSync(s.remote)).toEqual([]);
  });

  it("variable obligatoire absente : échec immédiat", () => {
    const s = setup();
    const { BACKUP_REMOTE: _omit, ...partial } = s.env;
    void _omit;
    const r = spawnSync("bash", [sh("ops/backup/backup.sh"), "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...partial } as unknown as NodeJS.ProcessEnv });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(/BACKUP_REMOTE/);
  });
});

describe.skipIf(!bashOk)("prune.sh et restore-verify.sh", () => {
  it("prune : simulation par défaut (aucune suppression), suppression seulement avec --apply", () => {
    const dir = tmp();
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const log = path.join(dir, "calls.log").replace(/\\/g, "/");
    const names = Array.from({ length: 40 }, (_, i) => `coachos-${new Date(Date.UTC(2026, 8, 1) + i * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "")}T033000Z.dump.age`);
    fake(bin, "rclone", `case "$1" in lsf) printf '%s\\n' ${names.map((n) => `"${n}"`).join(" ")} notes.txt;; *) echo "rclone $*" >> "${log}";; esac`);
    const env = { BACKUP_REMOTE: "offsite:coachos" };
    const dry = run("ops/backup/prune.sh", [], env, bin);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toMatch(/simulation/);
    expect(existsSync(log)).toBe(false);
    const apply = run("ops/backup/prune.sh", ["--apply"], env, bin);
    expect(apply.code, apply.out).toBe(0);
    const calls = readFileSync(log, "utf8");
    expect(calls).toMatch(/deletefile offsite:coachos\/coachos-20260901T033000Z\.dump\.age/);
    expect(calls).not.toMatch(/notes\.txt/);
    expect(calls).not.toContain(names[39]!); // la plus récente est conservée
  });

  it("restore-verify --dry-run : plan sans aucune commande ; sans fichier : usage ; la base temporaire est toujours « restore_check_* »", () => {
    const env = { RESTORE_ADMIN_URL: "postgresql://admin:pw@test.invalid/postgres", RESTORE_AGE_IDENTITY_FILE: "/chemin/inexistant" };
    const dry = run("ops/backup/restore-verify.sh", ["--dry-run", "sauvegarde.dump.age"], env);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toMatch(/createdb restore_check_\d{8}t\d{6}/);
    expect(dry.out).not.toMatch(/admin:|test\.invalid/);
    expect(run("ops/backup/restore-verify.sh", [], env).code).toBe(2);
  });
});

describe.skipIf(!bashOk)("activate.sh / rollback.sh avec de FAUX systemctl et curl", () => {
  const canSymlink = (() => {
    const d = tmp();
    try {
      mkdirSync(path.join(d, "a"));
      symlinkSync("a", path.join(d, "l"));
      return spawnSync("bash", ["-c", `test -L "${d.replace(/\\/g, "/")}/l"`]).status === 0;
    } catch {
      return false;
    }
  })();

  function layout() {
    const dir = tmp();
    const rootDir = path.join(dir, "srv").replace(/\\/g, "/");
    for (const id of ["v1", "v2"]) {
      mkdirSync(path.join(dir, "srv", "releases", id, ".next"), { recursive: true });
      writeFileSync(path.join(dir, "srv", "releases", id, "package.json"), "{}");
    }
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const log = path.join(dir, "calls.log").replace(/\\/g, "/");
    fake(bin, "systemctl", `echo "systemctl $*" >> "${log}"`);
    return { dir, bin, root: rootDir, log, env: { RELEASES_ROOT: rootDir, HEALTH_RETRIES: "2", HEALTH_RETRY_DELAY: "0", HEALTH_URL: "http://127.0.0.1:1/api/health" } };
  }
  const target = (root: string, name: string) => spawnSync("bash", ["-c", `basename "$(readlink "${root}/${name}")"`], { encoding: "utf8" }).stdout.trim();

  it("--dry-run : plan sans aucun changement", () => {
    const l = layout();
    const r = run("ops/release/activate.sh", ["--dry-run", "v1"], l.env, l.bin);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/La base de données n'est pas modifiée/);
    expect(existsSync(path.join(l.dir, "srv", "current"))).toBe(false);
    expect(existsSync(l.log)).toBe(false);
  });

  it("refuse un identifiant dangereux, une version absente et une version incomplète", () => {
    const l = layout();
    expect(run("ops/release/activate.sh", ["../etc"], l.env, l.bin).code).toBe(2);
    expect(run("ops/release/activate.sh", ["v9"], l.env, l.bin).code).toBe(3);
    mkdirSync(path.join(l.dir, "srv", "releases", "vide"));
    expect(run("ops/release/activate.sh", ["vide"], l.env, l.bin).code).toBe(3);
  });

  it.skipIf(!canSymlink)("activation saine, puis retour applicatif : aucune version supprimée", () => {
    const l = layout();
    fake(l.bin, "curl", "exit 0");
    expect(run("ops/release/activate.sh", ["v1"], l.env, l.bin).code).toBe(0);
    expect(run("ops/release/activate.sh", ["v2"], l.env, l.bin).code).toBe(0);
    expect(target(l.root, "current")).toBe("v2");
    expect(target(l.root, "previous")).toBe("v1");
    const rb = run("ops/release/rollback.sh", [], l.env, l.bin);
    expect(rb.code, rb.out).toBe(0);
    expect(target(l.root, "current")).toBe("v1");
    expect(readdirSync(path.join(l.dir, "srv", "releases")).sort()).toEqual(["v1", "v2"]);
    expect(readFileSync(l.log, "utf8").match(/systemctl restart coachos/g)).toHaveLength(3);
  });

  it.skipIf(!canSymlink)("service non prêt après activation : retour AUTOMATIQUE à la version précédente (code 5)", () => {
    const l = layout();
    fake(l.bin, "curl", "exit 0");
    expect(run("ops/release/activate.sh", ["v1"], l.env, l.bin).code).toBe(0);
    fake(l.bin, "curl", "exit 22"); // /api/health répond 503
    const r = run("ops/release/activate.sh", ["v2"], l.env, l.bin);
    expect(r.code).toBe(5);
    expect(r.out).toMatch(/retour automatique à v1/);
    expect(target(l.root, "current")).toBe("v1");
    expect(readdirSync(path.join(l.dir, "srv", "releases")).sort()).toEqual(["v1", "v2"]);
  });

  it("rollback sans version précédente : échec explicite, rien de modifié", () => {
    const l = layout();
    const r = run("ops/release/rollback.sh", [], l.env, l.bin);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/aucune version précédente/);
  });
});
