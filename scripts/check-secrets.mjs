// Vérifie les fichiers versionnés (git ls-files) : aucun secret évident, aucun .env réel, .gitignore protecteur.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { isForbiddenFile, scanText } from "./lib/secret-patterns.mjs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
const SKIP = new Set(["package-lock.json", "scripts/lib/secret-patterns.mjs", "tests/unit/secrets-scan.test.ts"]);
const problems = [];

for (const file of files) {
  if (!existsSync(file)) continue;
  if (isForbiddenFile(file)) problems.push(`${file} : fichier sensible versionné`);
  if (SKIP.has(file) || statSync(file).size > 2_000_000) continue;
  const buf = readFileSync(file);
  if (buf.includes(0)) continue; // binaire
  for (const f of scanText(buf.toString("utf8"))) problems.push(`${file}:${f.line} : ${f.name}`);
}

const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
for (const required of [".env*", "node_modules/"]) {
  if (!gitignore.includes(required)) problems.push(`.gitignore doit contenir « ${required} »`);
}

if (problems.length > 0) {
  console.error("Secrets ou fichiers sensibles détectés :\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`audit:secrets OK — ${files.length} fichiers versionnés analysés, aucun secret évident.`);
