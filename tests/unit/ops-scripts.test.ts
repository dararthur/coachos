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


describe("scripts d'exploitation : identifiants et retour arrière (analyse statique)", () => {
  it("aucun script n'accepte ni n'utilise d'URL de base avec identifiants ; le mot de passe passe par PGPASSFILE", () => {
    for (const s of ["ops/backup/backup.sh", "ops/backup/restore-verify.sh"]) {
      const active = read(s).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
      expect(active, s).not.toMatch(/postgres(ql)?:\/\//);
      expect(active, s).not.toMatch(/--dbname=["']?\$\{?(BACKUP|RESTORE)/); // l'ancienne forme --dbname="$…_URL"
      expect(active, s).not.toMatch(/PGPASSWORD=/);
      expect(active, s).toMatch(/export PGHOST=/);
      expect(active, s).toMatch(/PGPASSFILE=/);
      expect(active, s).toMatch(/unset PGPASSWORD/);
      expect(active, s).toMatch(/stat -c '%a'/);
    }
  });

  it("activate.sh : le redémarrage n'est jamais ignoré, et l'identité du processus est contrôlée", () => {
    const active = read("ops/release/activate.sh").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(active).not.toMatch(/systemctl restart[^\n]*\|\|\s*true/);
    expect(active).toMatch(/systemctl restart "\$SERVICE" \|\| fail_and_revert 6/);
    expect(active).toMatch(/verify_running "\$ID" "\$OLD_PID" \|\| fail_and_revert 5/);
    expect(active).toMatch(/MainPID/);
    expect(active).toMatch(/cwd/);
    // « previous » n'est écrit qu'après le contrôle de réussite (dernière instruction du script).
    const lines = active.split("\n");
    expect(lines.findIndex((l) => /link_set previous/.test(l))).toBeGreaterThan(lines.findIndex((l) => /verify_running "\$ID"/.test(l)));
    // Le mode « fichier » est réservé aux tests ; la valeur par défaut est le lien symbolique.
    expect(active).toMatch(/MODE="\$\{COACHOS_POINTER_MODE:-symlink\}"/);
  });

  it("l'unité d'exemple de l'application respecte le contrat avec activate.sh", () => {
    expect(read("ops/systemd/coachos.service")).toMatch(/^WorkingDirectory=\/srv\/coachos\/current$/m);
  });
});

// --- Faux binaires communs ---------------------------------------------------------------------------------------------------------
const PASS_SECRET = "motdepasse_fictif_0001";
const q = (p: string) => p.replace(/\\/g, "/");

describe.skipIf(!bashOk)("backup.sh : identifiants hors des arguments, avec de FAUX binaires (aucune sauvegarde réelle)", () => {
  function setup(mode = "600") {
    const dir = tmp();
    const bin = path.join(dir, "bin");
    const remote = path.join(dir, "remote");
    mkdirSync(bin);
    mkdirSync(remote);
    const recipients = path.join(dir, "recipients.txt");
    writeFileSync(recipients, "age1publiquefictif0000000000000000000000000000000000000000000\n");
    const passfile = path.join(dir, "backup.pgpass");
    writeFileSync(passfile, `db.invalid:5432:coachos:backup_ro:${PASS_SECRET}\n`);
    const log = q(path.join(dir, "calls.log"));
    // Le système de fichiers de développement (NTFS) ne représente pas les modes Unix : `stat` est simulé ; le vrai contrôle de mode est
    // testé séparément quand le système de fichiers le permet.
    fake(bin, "stat", `echo "\${FAKE_STAT_MODE:-${mode}}"`);
    fake(bin, "pg_dump", `echo "pg_dump ARGS: $*" >> "${log}"; env | grep '^PG' | sed 's/^/pg_dump ENV: /' >> "${log}"; for a in "$@"; do case "$a" in --file=*) printf 'DONNEES' > "\${a#--file=}";; esac; done`);
    fake(bin, "age", `echo "age ARGS: $*" >> "${log}"; out=""; in=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -R) shift;; *) in="$1";; esac; shift; done; cat "$in" | tr 'A-Z' 'a-z' > "$out"`);
    fake(bin, "rclone", `echo "rclone $*" >> "${log}"; r="${q(remote)}"; case "$1" in copyto) cp "$2" "$r/$(basename "$3")";; cat) cat "$r/$(basename "$2")";; esac`);
    const env: Record<string, string> = {
      BACKUP_PGHOST: "db.invalid",
      BACKUP_PGDATABASE: "coachos",
      BACKUP_PGUSER: "backup_ro",
      BACKUP_PGPASSFILE: q(passfile),
      BACKUP_AGE_RECIPIENTS_FILE: q(recipients),
      BACKUP_REMOTE: "offsite:coachos",
      BACKUP_WORKDIR: q(path.join(dir, "work")),
    };
    return { dir, bin, remote, env, log, passfile };
  }
  const noSecret = (text: string) => {
    expect(text).not.toContain(PASS_SECRET);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
  };

  it("--dry-run : plan affiché, aucun binaire appelé, aucun identifiant affiché", () => {
    const s = setup();
    const r = run("ops/backup/backup.sh", ["--dry-run"], s.env, s.bin);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/plan \(rien n'est exécuté\)/);
    noSecret(r.out);
    expect(existsSync(s.log)).toBe(false);
  });

  it("exécution complète : AUCUN identifiant dans les arguments des processus ni dans l'environnement transmis ; PGPASSFILE seul", () => {
    const s = setup();
    const r = run("ops/backup/backup.sh", [], { ...s.env, PGPASSWORD: "fuite_depuis_l_appelant", PGSERVICE: "autre" }, s.bin);
    expect(r.code, r.out).toBe(0);
    noSecret(r.out);
    const calls = readFileSync(s.log, "utf8");
    noSecret(calls);
    expect(calls).not.toContain("fuite_depuis_l_appelant");
    expect(calls).not.toMatch(/PGSERVICE/);
    expect(calls).not.toMatch(/PGPASSWORD/);
    expect(calls).toMatch(/pg_dump ARGS: --format=custom --no-password --file=/);
    expect(calls).not.toMatch(/pg_dump ARGS:[^\n]*(--dbname|db\.invalid|backup_ro)/);
    expect(calls).toContain(`pg_dump ENV: PGPASSFILE=${s.env.BACKUP_PGPASSFILE}`);
    expect(calls).toContain("pg_dump ENV: PGHOST=db.invalid");
    expect(calls).toContain("pg_dump ENV: PGSSLMODE=verify-full");
    const work = readdirSync(path.join(s.dir, "work"));
    expect(work.filter((f) => f.endsWith(".dump")), "aucun fichier en clair ne doit subsister").toEqual([]);
    expect(readdirSync(s.remote).sort()).toEqual(work.sort());
  });

  it("ancienne variable BACKUP_DATABASE_URL : refus explicite (code 2), rien d'exécuté, valeur jamais affichée", () => {
    const s = setup();
    const r = run("ops/backup/backup.sh", [], { ...s.env, BACKUP_DATABASE_URL: `postgresql://u:${PASS_SECRET}@db.invalid/coachos` }, s.bin);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/n'est plus admise/);
    noSecret(r.out);
    expect(existsSync(s.log)).toBe(false);
  });

  it("fichier de mots de passe lisible par d'autres (mode 0644) : refus AVANT toute commande, contenu jamais affiché", () => {
    const s = setup();
    const r = run("ops/backup/backup.sh", [], { ...s.env, FAKE_STAT_MODE: "644" }, s.bin);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/mode 0600/);
    noSecret(r.out);
    expect(existsSync(s.log)).toBe(false);
  });

  it("fichier de mots de passe absent ou répertoire : refus (code 3)", () => {
    const s = setup();
    expect(run("ops/backup/backup.sh", [], { ...s.env, BACKUP_PGPASSFILE: q(path.join(s.dir, "inexistant")) }, s.bin).code).toBe(3);
    expect(run("ops/backup/backup.sh", [], { ...s.env, BACKUP_PGPASSFILE: q(s.dir) }, s.bin).code).toBe(3);
    expect(existsSync(s.log)).toBe(false);
  });

  it("variable de connexion absente : échec immédiat, nommant la variable", () => {
    const s = setup();
    for (const name of ["BACKUP_PGHOST", "BACKUP_PGDATABASE", "BACKUP_PGUSER", "BACKUP_PGPASSFILE", "BACKUP_REMOTE"]) {
      const { [name]: _omit, ...partial } = s.env;
      void _omit;
      const r = spawnSync("bash", [sh("ops/backup/backup.sh"), "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...partial } as unknown as NodeJS.ProcessEnv });
      expect(r.status, name).not.toBe(0);
      expect(r.stderr, name).toContain(name);
    }
  });

  it("refuse une clé PRIVÉE age dans le fichier de destinataires, avant toute sauvegarde", () => {
    const s = setup();
    writeFileSync(s.env.BACKUP_AGE_RECIPIENTS_FILE!, "AGE-SECRET-KEY-1FICTIVE\n");
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/clé PRIVÉE/);
    expect(existsSync(s.log)).toBe(false);
  });

  it("copie distante différente de la locale : échec explicite (code 4)", () => {
    const s = setup();
    fake(s.bin, "rclone", `case "$1" in copyto) cp "$2" "${q(s.remote)}/$(basename "$3")";; cat) echo corrompu;; esac`);
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/diffère/);
  });

  it("échec de pg_dump : fichier en clair supprimé, rien d'envoyé, message sans identifiant", () => {
    const s = setup();
    fake(s.bin, "pg_dump", `for a in "$@"; do case "$a" in --file=*) printf 'PARTIEL' > "\${a#--file=}";; esac; done; echo "pg_dump: connexion impossible" >&2; exit 1`);
    const r = run("ops/backup/backup.sh", [], s.env, s.bin);
    expect(r.code).not.toBe(0);
    noSecret(r.out);
    expect(readdirSync(path.join(s.dir, "work"))).toEqual([]);
    expect(readdirSync(s.remote)).toEqual([]);
  });
});

// Contrôle de mode RÉEL (sans faux `stat`) : exécutable seulement si le système de fichiers représente les modes Unix (CI Linux).
const modesHonored = (() => {
  if (!bashOk) return false;
  const d = tmp();
  const f = q(path.join(d, "m"));
  return spawnSync("bash", ["-c", `echo x > "${f}" && chmod 640 "${f}" && test "$(stat -c %a "${f}")" = 640`]).status === 0;
})();

describe.skipIf(!bashOk || !modesHonored)("backup.sh : contrôle de mode RÉEL du fichier de mots de passe (système de fichiers Unix)", () => {
  it("0640 refusé, 0600 accepté, avec le vrai `stat`", () => {
    const dir = tmp();
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const passfile = path.join(dir, "p");
    writeFileSync(passfile, "x:5432:y:z:motdepasse_fictif_0002\n");
    const recipients = path.join(dir, "r");
    writeFileSync(recipients, "age1publiquefictif\n");
    for (const n of ["pg_dump", "age", "rclone"]) fake(bin, n, "exit 0");
    const env = { BACKUP_PGHOST: "h", BACKUP_PGDATABASE: "d", BACKUP_PGUSER: "u", BACKUP_PGPASSFILE: q(passfile), BACKUP_AGE_RECIPIENTS_FILE: q(recipients), BACKUP_REMOTE: "o:b", BACKUP_WORKDIR: q(path.join(dir, "w")) };
    chmodSync(passfile, 0o640);
    const bad = run("ops/backup/backup.sh", [], env, bin);
    expect(bad.code).toBe(3);
    expect(bad.out).toMatch(/mode 0600/);
    chmodSync(passfile, 0o600);
    expect(run("ops/backup/backup.sh", [], env, bin).out).not.toMatch(/mode 0600/);
  });
});

describe.skipIf(!bashOk)("restore-verify.sh avec de FAUX binaires (aucune restauration réelle)", () => {
  function setup(statMode = "600") {
    const dir = tmp();
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const log = q(path.join(dir, "calls.log"));
    const enc = path.join(dir, "coachos-20261013T033000Z.dump.age");
    writeFileSync(enc, "contenu-chiffre-fictif");
    const digest = spawnSync("bash", ["-c", `cd "${q(dir)}" && sha256sum "$(basename "${q(enc)}")" > "$(basename "${q(enc)}").sha256"`]);
    expect(digest.status).toBe(0);
    const passfile = path.join(dir, "restore.pgpass");
    writeFileSync(passfile, `restore.invalid:5432:*:admin_restore:${PASS_SECRET}\n`);
    const identity = path.join(dir, "identity.txt");
    writeFileSync(identity, "AGE-SECRET-KEY-FICTIVE\n"); // valeur trop courte pour être une vraie clé
    fake(bin, "stat", `echo "\${FAKE_STAT_MODE:-${statMode}}"`);
    fake(bin, "age", `echo "age ARGS: $*" >> "${log}"; out=""; in=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -i) shift;; -d) ;; *) in="$1";; esac; shift; done; cp "$in" "$out"`);
    fake(bin, "createdb", `echo "createdb ARGS: $* | PGDATABASE=$PGDATABASE" >> "${log}"`);
    fake(bin, "dropdb", `echo "dropdb ARGS: $* | PGDATABASE=$PGDATABASE" >> "${log}"`);
    fake(bin, "pg_restore", `echo "pg_restore ARGS: $* | PGDATABASE=$PGDATABASE" >> "${log}"; env | grep '^PG' | sed 's/^/pg_restore ENV: /' >> "${log}"`);
    fake(
      bin,
      "psql",
      `echo "psql ARGS: $* | PGDATABASE=$PGDATABASE" >> "${log}"; sql="$*"; case "$sql" in *pg_roles*) echo "\${FAKE_ROLES:-4}";; *rowsecurity*) echo "\${FAKE_NO_RLS:-0}";; *to_regclass*) echo t;; *"schemaname='auth'"*) echo 4;; *coachos_migrations*) echo t;; esac`,
    );
    const env: Record<string, string> = {
      RESTORE_PGHOST: "restore.invalid",
      RESTORE_PGUSER: "admin_restore",
      RESTORE_PGPASSFILE: q(passfile),
      RESTORE_AGE_IDENTITY_FILE: q(identity),
    };
    return { dir, bin, log, enc: q(enc), env };
  }
  const noSecret = (text: string) => {
    expect(text).not.toContain(PASS_SECRET);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(text).not.toContain("AGE-SECRET-KEY");
  };

  it("--dry-run : plan sans aucune commande ; sans fichier : usage ; le nom de la base temporaire est toujours « restore_check_* »", () => {
    const s = setup();
    const dry = run("ops/backup/restore-verify.sh", ["--dry-run", s.enc], s.env, s.bin);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toMatch(/createdb restore_check_\d{8}t\d{6}/);
    noSecret(dry.out);
    expect(existsSync(s.log)).toBe(false);
    expect(run("ops/backup/restore-verify.sh", [], s.env, s.bin).code).toBe(2);
  });

  it("restauration vérifiée : aucun identifiant dans les arguments, base temporaire créée PUIS supprimée, rien d'autre supprimé", () => {
    const s = setup();
    const r = run("ops/backup/restore-verify.sh", [s.enc], s.env, s.bin);
    expect(r.code, r.out).toBe(0);
    noSecret(r.out);
    const calls = readFileSync(s.log, "utf8");
    noSecret(calls);
    expect(calls).toContain("pg_restore ENV: PGPASSFILE=");
    expect(calls).not.toMatch(/PGPASSWORD/);
    const created = /createdb ARGS: --no-password (restore_check_\d{8}t\d{6})/.exec(calls)?.[1];
    expect(created).toBeTruthy();
    expect(calls).toMatch(new RegExp(`pg_restore ARGS: --exit-on-error --single-transaction --no-password --dbname=${created} `));
    const drops = [...calls.matchAll(/dropdb ARGS: ([^|]*)\|/g)].map((m) => m[1]!.trim());
    expect(drops).toEqual([`--if-exists --no-password ${created}`]);
    expect(calls.indexOf("createdb")).toBeLessThan(calls.indexOf("pg_restore"));
  });

  it("rôles Coach OS absents du serveur de restauration : refus AVANT toute création de base (code 3)", () => {
    const s = setup();
    const r = run("ops/backup/restore-verify.sh", [s.enc], { ...s.env, FAKE_ROLES: "3" }, s.bin);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/4 rôles Coach OS/);
    expect(r.out).toMatch(/Rien n'a été restauré/);
    const calls = readFileSync(s.log, "utf8");
    expect(calls).not.toMatch(/createdb|pg_restore|dropdb/);
  });

  it("contrôle post-restauration en échec (table sans RLS) : code 4 ET la base temporaire est quand même supprimée", () => {
    const s = setup();
    const r = run("ops/backup/restore-verify.sh", [s.enc], { ...s.env, FAKE_NO_RLS: "2" }, s.bin);
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/ÉCHEC tables publiques sans RLS/);
    expect(readFileSync(s.log, "utf8")).toMatch(/dropdb ARGS: --if-exists --no-password restore_check_/);
  });

  it("somme SHA-256 non conforme : arrêt avant déchiffrement, aucune base créée", () => {
    const s = setup();
    writeFileSync(s.enc, "contenu-altere");
    const r = run("ops/backup/restore-verify.sh", [s.enc], s.env, s.bin);
    expect(r.code).not.toBe(0);
    expect(existsSync(s.log) ? readFileSync(s.log, "utf8") : "").not.toMatch(/age ARGS|createdb/);
  });

  it("ancienne variable RESTORE_ADMIN_URL, fichier de mots de passe ou clé privée trop ouverts : refus (identifiants jamais affichés)", () => {
    const s = setup();
    const legacy = run("ops/backup/restore-verify.sh", [s.enc], { ...s.env, RESTORE_ADMIN_URL: `postgresql://a:${PASS_SECRET}@h/db` }, s.bin);
    expect(legacy.code).toBe(2);
    noSecret(legacy.out);
    const open = run("ops/backup/restore-verify.sh", [s.enc], { ...s.env, FAKE_STAT_MODE: "644" }, s.bin);
    expect(open.code).toBe(3);
    expect(open.out).toMatch(/mode 0600/);
    noSecret(open.out);
    expect(existsSync(s.log)).toBe(false);
  });
});

describe.skipIf(!bashOk)("prune.sh", () => {
  it("simulation par défaut (aucune suppression), suppression seulement avec --apply", () => {
    const dir = tmp();
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const log = q(path.join(dir, "calls.log"));
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
});

// --- activate.sh / rollback.sh ----------------------------------------------------------------------------------------------------
const canSymlink = (() => {
  if (!bashOk) return false;
  const d = tmp();
  try {
    mkdirSync(path.join(d, "a"));
    symlinkSync("a", path.join(d, "l"));
    return spawnSync("bash", ["-c", `test -L "${q(d)}/l"`]).status === 0;
  } catch {
    return false;
  }
})();
const hasFlock = bashOk && spawnSync("bash", ["-c", "command -v flock"]).status === 0;

/**
 * Deux modes : « file » (les liens current/previous sont de simples fichiers : s'exécute aussi sous Windows) et « symlink » (la vraie
 * forme de production : exécuté là où les liens symboliques existent, donc en CI Linux). La logique testée est la même.
 */
const MODES: { mode: "file" | "symlink"; skip: boolean }[] = [
  { mode: "file", skip: !bashOk },
  { mode: "symlink", skip: !bashOk || !canSymlink },
];

for (const { mode, skip } of MODES) {
  describe.skipIf(skip)(`activate.sh / rollback.sh [liens : ${mode}] avec un FAUX systemctl et un FAUX curl`, { timeout: 90_000 }, () => {
    function layout(ids = ["v1", "v2", "v3"]) {
      const dir = tmp();
      const rootDir = q(path.join(dir, "srv"));
      for (const id of ids) {
        mkdirSync(path.join(dir, "srv", "releases", id, ".next"), { recursive: true });
        writeFileSync(path.join(dir, "srv", "releases", id, "package.json"), "{}");
      }
      const bin = path.join(dir, "bin");
      const state = path.join(dir, "state");
      mkdirSync(bin);
      mkdirSync(state);
      const proc = q(path.join(dir, "proc"));
      mkdirSync(proc);
      const S = q(state);
      const currentId = `if [ "$COACHOS_POINTER_MODE" = file ]; then tr -d '\\r\\n' < "$RELEASES_ROOT/current"; else basename "$(readlink "$RELEASES_ROOT/current")"; fi`;
      fake(
        bin,
        "systemctl",
        `d="${S}"; pid=$(cat "$d/pid" 2>/dev/null || echo 0)
case "$1" in
  show) echo "$pid";;
  is-active) [ -f "$d/inactive" ] && exit 3; exit 0;;
  restart)
    n=$(cat "$d/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/n"; echo "restart#$n" >> "$d/calls"
    [ "$(cat "$d/fail_at" 2>/dev/null)" = "$n" ] && exit 1
    [ "$(cat "$d/keep_pid_at" 2>/dev/null)" = "$n" ] && exit 0
    pid=$((pid+1)); echo $pid > "$d/pid"
    id=$(${currentId}); dir=$(cd "$RELEASES_ROOT/releases/$id" && pwd -P)
    [ "$(cat "$d/stale_at" 2>/dev/null)" = "$n" ] && dir=$(cd "$RELEASES_ROOT/releases/$(cat "$d/stale_id")" && pwd -P)
    mkdir -p "$PROC_ROOT/$pid"
    if [ "$COACHOS_POINTER_MODE" = file ]; then printf '%s' "$dir" > "$PROC_ROOT/$pid/cwd"; else ln -sfn "$dir" "$PROC_ROOT/$pid/cwd"; fi;;
esac`,
      );
      fake(
        bin,
        "curl",
        `d="${S}"; id=$(${currentId} 2>/dev/null || echo none)
[ "$(cat "$d/bad_id" 2>/dev/null)" = "$id" ] && exit 22
if [ -f "$d/bump_on_curl" ]; then echo $(( $(cat "$d/pid") + 1 )) > "$d/pid"; fi
exit 0`,
      );
      const env: Record<string, string> = {
        RELEASES_ROOT: rootDir,
        PROC_ROOT: proc,
        COACHOS_POINTER_MODE: mode,
        HEALTH_RETRIES: "2",
        HEALTH_RETRY_DELAY: "0",
        HEALTH_URL: "http://127.0.0.1:1/api/health",
        FAKE_STATE: S,
      };
      const flag = (name: string, value = "1") => writeFileSync(path.join(state, name), value);
      const calls = () => (existsSync(path.join(state, "calls")) ? readFileSync(path.join(state, "calls"), "utf8").trim().split("\n") : []);
      const ptr = (name: string): string | null => {
        const p = path.join(dir, "srv", name);
        if (mode === "file") return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
        const r = spawnSync("bash", ["-c", `[ -L "${q(p)}" ] && basename "$(readlink "${q(p)}")"`], { encoding: "utf8" });
        return r.status === 0 ? r.stdout.trim() : null;
      };
      const setPtr = (name: string, id: string) => {
        const p = path.join(dir, "srv", name);
        if (mode === "file") writeFileSync(p, `${id}\n`);
        else spawnSync("bash", ["-c", `ln -sfn "releases/${id}" "${q(p)}"`]);
      };
      const releases = () => readdirSync(path.join(dir, "srv", "releases")).sort();
      const act = (...args: string[]) => run("ops/release/activate.sh", args, env, bin);
      const rb = (...args: string[]) => run("ops/release/rollback.sh", args, env, bin);
      return { dir, bin, env, flag, calls, ptr, setPtr, releases, act, rb };
    }

    it("--dry-run : plan sans aucun changement ni appel", () => {
      const l = layout();
      const r = l.act("--dry-run", "v1");
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/La base de données n'est pas modifiée/);
      expect(l.ptr("current")).toBeNull();
      expect(l.calls()).toEqual([]);
    });

    it("refuse un identifiant dangereux, une version absente et une version incomplète", () => {
      const l = layout();
      expect(l.act("../etc").code).toBe(2);
      expect(l.act("v9").code).toBe(3);
      mkdirSync(path.join(l.dir, "srv", "releases", "vide"));
      expect(l.act("vide").code).toBe(3);
      expect(l.calls()).toEqual([]);
    });

    it("première activation saine : current vérifié (nouveau PID, bon dossier, santé), previous absent", () => {
      const l = layout();
      const r = l.act("v1");
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/active et vérifiée : v1/);
      expect(l.ptr("current")).toBe("v1");
      expect(l.ptr("previous")).toBeNull();
      expect(l.calls()).toEqual(["restart#1"]);
    });

    it("activation suivante saine : previous = ancienne version, écrite seulement après le succès ; rollback manuel puis nouveau rollback", () => {
      const l = layout();
      expect(l.act("v1").code).toBe(0);
      expect(l.act("v2").code).toBe(0);
      expect([l.ptr("current"), l.ptr("previous")]).toEqual(["v2", "v1"]);
      const back = l.rb();
      expect(back.code, back.out).toBe(0);
      expect([l.ptr("current"), l.ptr("previous")]).toEqual(["v1", "v2"]);
      expect(l.rb().code).toBe(0); // bascule inverse, toujours vérifiée
      expect(l.ptr("current")).toBe("v2");
      expect(l.releases()).toEqual(["v1", "v2", "v3"]); // aucune version supprimée
    });

    it("nouvelle version non prête (santé) : retour automatique VÉRIFIÉ à l'ancienne, current et previous inchangés (code 5)", () => {
      const l = layout();
      expect(l.act("v1").code).toBe(0);
      expect(l.act("v2").code).toBe(0);
      l.flag("bad_id", "v3");
      const r = l.act("v3");
      expect(r.code).toBe(5);
      expect(r.out).toMatch(/retour automatique à v2 \(vérifié\)/);
      expect([l.ptr("current"), l.ptr("previous")]).toEqual(["v2", "v1"]);
      expect(l.releases()).toEqual(["v1", "v2", "v3"]);
    });

    it("rollback manuel IMMÉDIATEMENT après un échec d'activation : suit « previous » (ici v1), jamais la version défaillante", () => {
      const l = layout();
      l.act("v1");
      l.act("v2");
      l.flag("bad_id", "v3");
      expect(l.act("v3").code).toBe(5);
      const r = l.rb();
      expect(r.code, r.out).toBe(0);
      expect(l.ptr("current")).toBe("v1");
      expect(l.ptr("previous")).toBe("v2");
    });

    it("échec de `systemctl restart` : l'opération ÉCHOUE (code 6), retour à l'ancienne version, jamais un faux succès", () => {
      const l = layout();
      expect(l.act("v1").code).toBe(0); // restart#1
      l.flag("fail_at", "2");
      const r = l.act("v2"); // restart#2 échoue, restart#3 = retour arrière
      expect(r.code).toBe(6);
      expect(r.out).toMatch(/systemctl restart coachos a échoué/);
      expect(r.out).toMatch(/retour automatique à v1 \(vérifié\)/);
      expect([l.ptr("current"), l.ptr("previous")]).toEqual(["v1", null]);
      expect(l.calls()).toEqual(["restart#1", "restart#2", "restart#3"]);
    });

    it("un ANCIEN processus encore en vie ne prouve rien : PID inchangé après redémarrage => échec (code 7 si le retour est lui aussi non prouvable)", () => {
      const l = layout();
      expect(l.act("v1").code).toBe(0);
      l.flag("keep_pid_at", "2"); // restart#2 « réussit » sans remplacer le processus ; restart#3 (retour) le remplace
      const r = l.act("v2");
      expect(r.out).toMatch(/n'a pas été remplacé/);
      expect(r.code).toBe(5);
      expect(l.ptr("current")).toBe("v1");
    });

    it("processus qui tourne encore depuis l'ancienne version (même avec un nouveau PID et une santé 200) : échec (code 5)", () => {
      const l = layout();
      expect(l.act("v1").code).toBe(0);
      l.flag("stale_at", "2");
      l.flag("stale_id", "v1");
      const r = l.act("v2");
      expect(r.code).toBe(5);
      expect(r.out).toMatch(/ne tourne pas depuis la version v2/);
      expect(l.ptr("current")).toBe("v1");
    });

    it("service inactif ou instable (redémarre pendant le contrôle) : échec", () => {
      const l = layout();
      expect(l.act("v1").code).toBe(0);
      l.flag("bump_on_curl");
      const r = l.act("v2");
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/redémarré pendant le contrôle/);
      expect(l.ptr("current")).toBe("v1");
    });

    it("première activation en échec de santé : aucun retour possible ; current écarté (current.failed), versions intactes", () => {
      const l = layout();
      l.flag("bad_id", "v1");
      const r = l.act("v1");
      expect(r.code).toBe(5);
      expect(r.out).toMatch(/première activation/);
      expect(l.ptr("current")).toBeNull();
      expect(l.ptr("current.failed")).toBe("v1");
      expect(l.releases()).toEqual(["v1", "v2", "v3"]);
    });

    it("première activation avec échec du redémarrage : code 6, current écarté", () => {
      const l = layout();
      l.flag("fail_at", "1");
      const r = l.act("v1");
      expect(r.code).toBe(6);
      expect(l.ptr("current")).toBeNull();
    });

    it("rollback sans version précédente, ou « previous » identique à la version active : refus sans rien changer", () => {
      const l = layout();
      l.act("v1");
      const none = l.rb();
      expect(none.code).toBe(3);
      expect(none.out).toMatch(/aucune version précédente/);
      l.setPtr("previous", "v1");
      const same = l.rb();
      expect(same.code).toBe(3);
      expect(same.out).toMatch(/identique à la version active/);
      expect(l.ptr("current")).toBe("v1");
      expect(l.calls()).toEqual(["restart#1"]);
    });

    it("--no-restart : bascule seulement, avertissement « NON vérifiée », aucun appel à systemctl", () => {
      const l = layout();
      const r = l.act("--no-restart", "v1");
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/NON vérifiée/);
      expect(l.ptr("current")).toBe("v1");
      expect(l.calls()).toEqual([]);
    });

    it.skipIf(!hasFlock)("deux activations simultanées : la seconde est refusée (code 4)", () => {
      const l = layout();
      const lock = path.join(l.dir, "srv", ".activate.lock");
      const holder = spawnSync("bash", ["-c", `exec 8>"${q(lock)}"; flock -n 8 && ( RELEASES_ROOT="${l.env.RELEASES_ROOT}" COACHOS_POINTER_MODE=${mode} PATH="${q(l.bin)}:$PATH" bash "${sh("ops/release/activate.sh")}" v1; echo "code=$?" )`], { encoding: "utf8" });
      expect(holder.stdout + holder.stderr).toMatch(/code=4|une autre activation/);
    });
  });
}
