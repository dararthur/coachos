// Lit des noms de fichiers sur l'entrée standard, affiche (un par ligne) ceux que la politique de rétention désigne à supprimer.
// Ne supprime rien. Usage : rclone lsf REMOTE | node scripts/backup-retention.mjs [--daily N] [--weekly N] [--monthly N]
import { DEFAULT_POLICY, planRetention } from "./lib/backup-retention.mjs";

const args = process.argv.slice(2);
const policy = { ...DEFAULT_POLICY };
for (let i = 0; i < args.length; i += 2) {
  const k = args[i]?.replace(/^--/, "");
  const v = Number(args[i + 1]);
  if (!(k in policy) || !Number.isInteger(v) || v < 1) {
    console.error("Usage : backup-retention.mjs [--daily N] [--weekly N] [--monthly N] (entiers ≥ 1)");
    process.exit(2);
  }
  policy[k] = v;
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const plan = planRetention(input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), policy);
for (const name of plan.delete) console.log(name);
console.error(`rétention : ${plan.keep.length} conservée(s), ${plan.delete.length} à supprimer`);
