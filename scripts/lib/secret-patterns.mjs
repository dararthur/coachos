// Détection défensive de secrets dans les fichiers versionnés. Volontairement simple et sans dépendance :
// elle complète (ne remplace pas) un outil dédié type gitleaks, lancé en CI.

export const SECRET_PATTERNS = [
  { name: "clé privée", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "jeton JWT (3 segments base64url)", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "clé secrète Supabase", re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "clé API Resend", re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b|\bre_[A-Za-z0-9]{24,}\b/ },
  { name: "clé AWS", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "jeton GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "clé API Stripe/OpenAI/Anthropic", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bsk-(?:ant-)?[A-Za-z0-9_-]{30,}\b/ },
  {
    name: "URL de base de données avec mot de passe réel",
    re: /\bpostgres(?:ql)?:\/\/[^:\s/@]+:(?!CHANGE_ME|PASSWORD|password|\$|\{|<|x{3,}|\*{3,}|\.\.\.)[^@\s'"`]{6,}@(?!127\.0\.0\.1|localhost|\$|\{)/i,
  },
  {
    name: "affectation de secret en clair",
    re: /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_?KEY|SERVICE_ROLE)[A-Z0-9_]*\s*[:=]\s*['"]?(?!CHANGE_ME|\$|\{|<|process\.env|env\(|randomBytes|your_|example|xxx|\s|['"]?$)[A-Za-z0-9/+_=-]{24,}['"]?/,
  },
];

/** Fichiers qui ne doivent jamais être versionnés (hors exemples). */
export function isForbiddenFile(path) {
  const base = path.split("/").pop() ?? path;
  if (/^\.env(\..+)?$/.test(base) && !/\.example$/.test(base)) return true;
  return /\.(pem|key|p12|pfx)$/i.test(base);
}

/** @returns {{ name: string, line: number }[]} */
export function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.length > 4000) return;
    for (const { name, re } of SECRET_PATTERNS) if (re.test(line)) findings.push({ name, line: index + 1 });
  });
  return findings;
}
