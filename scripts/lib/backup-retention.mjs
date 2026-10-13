// Rétention des sauvegardes : fonction PURE (aucun accès disque ni réseau). Ne désigne à supprimer que des fichiers dont le nom suit
// exactement le format produit par ops/backup/backup.sh ; tout autre nom est ignoré (jamais supprimé).
export const BACKUP_NAME = /^coachos-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.age$/;
/** Objectifs PROPOSÉS (à valider avec le client et le coût de stockage) : 14 jours, 8 semaines, 6 mois. */
export const DEFAULT_POLICY = { daily: 14, weekly: 8, monthly: 6 };

function parse(name) {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? null : { name, date };
}
const dayKey = (d) => d.toISOString().slice(0, 10);
const monthKey = (d) => d.toISOString().slice(0, 7);
function weekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

/** @param {string[]} names @param {{ daily: number, weekly: number, monthly: number }} [policy] */
export function planRetention(names, policy = DEFAULT_POLICY) {
  const items = names.map(parse).filter(Boolean).sort((a, b) => b.date - a.date); // du plus récent au plus ancien
  const keep = new Set();
  if (items[0]) keep.add(items[0].name); // la sauvegarde la plus récente n'est JAMAIS supprimée
  for (const [keyFn, count] of [[dayKey, policy.daily], [weekKey, policy.weekly], [monthKey, policy.monthly]]) {
    const seen = new Set();
    for (const it of items) {
      const k = keyFn(it.date);
      if (seen.has(k)) continue; // une seule sauvegarde (la plus récente) par jour / semaine / mois
      if (seen.size >= count) break;
      seen.add(k);
      keep.add(it.name);
    }
  }
  return { keep: items.filter((i) => keep.has(i.name)).map((i) => i.name), delete: items.filter((i) => !keep.has(i.name)).map((i) => i.name) };
}
