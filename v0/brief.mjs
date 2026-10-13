#!/usr/bin/env node
/**
 * CoachOS V0 — generateur de brief hebdomadaire.
 *
 * Outil interne de fondateur, PAS le produit du client.
 * Entree : un export de presences en CSV (n'importe quel logiciel).
 * Sortie : un message WhatsApp pret a copier + un brief Markdown + un JSON tracable.
 *
 * Zero dependance. Node >= 18.
 *
 *   node brief.mjs data/demo-academy.csv --gym "Alma BJJ" --lang fr
 *
 * Specification des regles : voir RULES.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------- parametres
const CFG = {
  baselineFromDays: 70,   // fenetre de reference : J-70 ...
  baselineToDays: 14,     // ... jusqu'a J-14 (exclut la chute recente)
  recentDays: 14,
  newTenureDays: 42,      // "nouveau" = 6 semaines
  returnGapDays: 21,      // coupure consideree comme une vraie absence
  returnWindowDays: 7,    // retour detecte s'il a eu lieu cette semaine
  maxDaysSince: 60,       // au-dela : campagne de win-back, pas un brief hebdo
  perRuleCap: 2,          // anti-brief-deprimant
  coolDownBriefs: 2,      // anti-fatigue : deja signale N fois et toujours absent
  top: 5,
};

// ------------------------------------------------------------------------ CLI
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ------------------------------------------------------------------------ CSV
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase().replace(/[\s\-.]+/g, '_'));
  return rows.slice(1)
    .filter(r => r.some(v => v && v.trim()))
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// Chaque logiciel exporte differemment. On devine.
const ALIASES = {
  id:    ['student_id', 'member_id', 'person_id', 'user_id', 'id', 'membre_id', 'eleve_id'],
  name:  ['student_name', 'member_name', 'full_name', 'name', 'student', 'member', 'nom', 'eleve', 'adherent'],
  first: ['first_name', 'firstname', 'prenom', 'given_name'],
  last:  ['last_name', 'lastname', 'surname', 'family_name'],
  date:  ['date', 'class_date', 'checkin_date', 'check_in_date', 'attended_at', 'checked_in_at', 'timestamp', 'datetime', 'day'],
  klass: ['class', 'class_name', 'program', 'session', 'activity', 'cours', 'type'],
};
const pick = (cols, keys) => keys.find(k => cols.includes(k)) || null;

function detectColumns(rows) {
  const cols = Object.keys(rows[0] || {});
  const c = {
    id: pick(cols, ALIASES.id),
    name: pick(cols, ALIASES.name),
    first: pick(cols, ALIASES.first),
    last: pick(cols, ALIASES.last),
    date: pick(cols, ALIASES.date),
    klass: pick(cols, ALIASES.klass),
  };
  if (!c.date) throw new Error(`Aucune colonne de date trouvee. Colonnes vues : ${cols.join(', ')}`);
  if (!c.name && !c.first && !c.id) throw new Error(`Aucune colonne de nom trouvee. Colonnes vues : ${cols.join(', ')}`);
  return c;
}

// Formats : ISO, DD/MM/YYYY, MM/DD/YYYY. L'ambiguite se tranche sur l'ensemble du fichier.
function inferDayFirst(rows, dateCol) {
  for (const r of rows) {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(r[dateCol] || '');
    if (m && +m[1] > 12) return true;
  }
  return false;
}

function parseDate(raw, dayFirst) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = String(2000 + +y);
    const d = dayFirst ? +m[1] : +m[2];
    const mo = dayFirst ? +m[2] : +m[1];
    return Date.UTC(+y, mo - 1, d);
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const dt = new Date(t);
  return Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

// -------------------------------------------------------------------- lecture
function loadAttendance(file) {
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  if (!rows.length) throw new Error(`${file} est vide.`);
  const c = detectColumns(rows);
  const dayFirst = inferDayFirst(rows, c.date);
  const students = new Map();
  let skipped = 0;

  for (const r of rows) {
    const ts = parseDate(r[c.date], dayFirst);
    if (ts === null) { skipped++; continue; }
    const name = c.name
      ? r[c.name]
      : ([r[c.first], r[c.last]].filter(Boolean).join(' ').trim() || (c.id ? r[c.id] : ''));
    if (!name) { skipped++; continue; }
    const id = (c.id && r[c.id]) ? r[c.id] : name.toLowerCase().replace(/\s+/g, '_');
    if (!students.has(id)) students.set(id, { id, name, dates: [] });
    students.get(id).dates.push(ts);
  }
  for (const s of students.values()) s.dates = [...new Set(s.dates)].sort((a, b) => a - b);
  return { students: [...students.values()], skipped, dayFirst, columns: c };
}

function loadNotes(file) {
  const byStudent = new Map();
  if (!file || !fs.existsSync(file)) return byStudent;
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return byStudent;
  const c = detectColumns(rows);
  const dayFirst = inferDayFirst(rows, c.date);
  for (const r of rows) {
    const ts = parseDate(r[c.date], dayFirst);
    const key = (c.id && r[c.id])
      ? r[c.id]
      : String(c.name ? r[c.name] : '').toLowerCase().replace(/\s+/g, '_');
    if (ts === null || !key) continue;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(ts);
  }
  return byStudent;
}

// ---------------------------------------------------------------------- faits
function computeFacts(student, ref, notes) {
  const d = student.dates;
  const lastSeen = d[d.length - 1];
  const firstSeen = d[0];
  const daysSince = Math.floor((ref - lastSeen) / DAY);
  const tenureDays = Math.floor((ref - firstSeen) / DAY);

  const bFrom = ref - CFG.baselineFromDays * DAY;
  const bTo = ref - CFG.baselineToDays * DAY;
  const baselineWeeks = (CFG.baselineFromDays - CFG.baselineToDays) / 7;
  const baselinePerWeek = d.filter(t => t >= bFrom && t < bTo).length / baselineWeeks;
  const recentPerWeek = d.filter(t => t >= ref - CFG.recentDays * DAY).length / (CFG.recentDays / 7);

  const deltaPct = baselinePerWeek > 0 ? (recentPerWeek - baselinePerWeek) / baselinePerWeek : null;
  const expectedGapDays = baselinePerWeek > 0 ? 7 / baselinePerWeek : null;
  const gapRatio = expectedGapDays ? daysSince / expectedGapDays : null;

  let isReturning = false, returnGap = 0;
  for (let i = d.length - 1; i > 0; i--) {
    const gap = Math.floor((d[i] - d[i - 1]) / DAY);
    if (gap >= CFG.returnGapDays) {
      if ((ref - d[i]) / DAY <= CFG.returnWindowDays) { isReturning = true; returnGap = gap; }
      break;
    }
  }

  const weekOf = t => Math.floor((t - Date.UTC(2024, 0, 1)) / (7 * DAY));
  const weeks = new Set(d.map(weekOf));
  let streakWeeks = 0;
  for (let w = weekOf(ref); weeks.has(w); w--) streakWeeks++;

  const noteDates = notes.get(student.id) || [];
  const lastNote = noteDates.length ? Math.max(...noteDates) : null;

  return {
    lastSeen, firstSeen, daysSince, tenureDays,
    totalClasses: d.length,
    baselinePerWeek: +baselinePerWeek.toFixed(2),
    recentPerWeek: +recentPerWeek.toFixed(2),
    deltaPct: deltaPct === null ? null : +deltaPct.toFixed(2),
    expectedGapDays: expectedGapDays === null ? null : +expectedGapDays.toFixed(1),
    gapRatio: gapRatio === null ? null : +gapRatio.toFixed(1),
    isNew: tenureDays <= CFG.newTenureDays,
    isReturning, returnGap, streakWeeks,
    hasNotes: noteDates.length > 0,
    daysSinceNote: lastNote ? Math.floor((ref - lastNote) / DAY) : null,
  };
}

// --------------------------------------------------------------------- regles
const RULES = [
  {
    code: 'NEW_SLIPPING', tier: 1,
    when: f => f.isNew && f.daysSince >= 7 && f.totalClasses >= 2,
    uses: ['tenureDays', 'totalClasses', 'daysSince'],
  },
  {
    code: 'FADING', tier: 2,
    when: f => f.baselinePerWeek >= 1.5 && f.deltaPct !== null && f.deltaPct <= -0.5 && f.daysSince <= 10,
    uses: ['baselinePerWeek', 'recentPerWeek', 'deltaPct'],
  },
  {
    code: 'RETURNED', tier: 3,
    when: f => f.isReturning,
    uses: ['returnGap', 'daysSince'],
  },
  {
    code: 'GHOST', tier: 4,
    when: f => f.gapRatio !== null && f.gapRatio >= 3 && f.daysSince >= 10 && f.totalClasses >= 8,
    uses: ['baselinePerWeek', 'daysSince', 'gapRatio'],
  },
  {
    code: 'NEW_UNSEEN', tier: 5,
    when: f => f.isNew && f.totalClasses >= 3 && !f.hasNotes && f.daysSince < 7,
    uses: ['tenureDays', 'totalClasses'],
  },
  {
    code: 'QUIET_RELIABLE', tier: 6,
    when: f => f.streakWeeks >= 8 && f.baselinePerWeek >= 2 &&
               (!f.hasNotes || (f.daysSinceNote !== null && f.daysSinceNote >= 60)),
    uses: ['streakWeeks', 'baselinePerWeek'],
  },
];

// ------------------------------------------------------------------ redaction
let LANG = 'fr';
const wk = n => {
  const s = (Math.round(n * 10) / 10).toString();
  return LANG === 'fr' ? s.replace('.', ',') : s;
};

const COPY = {
  fr: {
    NEW_SLIPPING: f => [
      `nouveau depuis ${Math.round(f.tenureDays / 7)} semaines, ${f.totalClasses} cours, plus rien depuis ${f.daysSince} jours`,
      `Un message aujourd'hui. Un nouveau absent 7 jours est generalement deja parti.`],
    FADING: f => [
      `est passe de ${wk(f.baselinePerWeek)} a ${wk(f.recentPerWeek)} cours/semaine`,
      `Il vient encore : parle-lui sur le tatami cette semaine.`],
    RETURNED: f => [
      `de retour apres ${f.returnGap} jours d'absence`,
      `30 secondes : "content de te revoir". Le 2e retour se joue sur le 1er.`],
    GHOST: f => [
      `venait ${wk(f.baselinePerWeek)}x/semaine, plus rien depuis ${f.daysSince} jours`,
      `Message personnel. Pas de reproche, pas d'offre commerciale.`],
    NEW_UNSEEN: f => [
      `nouveau, ${f.totalClasses} cours, aucun retour individuel de ta part`,
      `2 minutes de feedback apres le cours.`],
    QUIET_RELIABLE: f => [
      `assidu depuis ${f.streakWeeks} semaines, jamais eu de retour de ta part`,
      `Ceux-la partent sans prevenir. Un mot suffit.`],
    title: g => `LE BRIEF — ${g}`,
    sub: 'Les personnes a qui parler cette semaine',
    none: 'Aucun signal cette semaine. Tout le monde est dans son rythme habituel.',
    ask: 'Reponds juste avec les numeros : 1 PARLE · 2 PAS EU LE TEMPS · 3 PERDU',
    stale: n => `${n} eleve(s) sans nouvelles depuis plus de 60 jours — campagne de win-back separee, pas ce brief.`,
    report: 'CE QUE CA A DONNE LA SEMAINE DERNIERE',
    reportLine: (spoke, back) => `Tu as parle a ${spoke} personne(s). ${back} sont revenues sur le tatami.`,
    reportValue: v => `Environ ${v} EUR de revenu mensuel conserve.`,
    analysed: n => `${n} eleves analyses`,
    benched: n => `${n} deja signale(s) les semaines precedentes, mis en pause (anti-fatigue).`,
    facts: 'faits',
    returned: 'Revenus',
  },
  en: {
    NEW_SLIPPING: f => [
      `new (${Math.round(f.tenureDays / 7)} weeks), ${f.totalClasses} classes, nothing for ${f.daysSince} days`,
      `Message them today. A new student 7 days out is usually already gone.`],
    FADING: f => [
      `dropped from ${wk(f.baselinePerWeek)} to ${wk(f.recentPerWeek)} classes/week`,
      `They still show up: talk to them on the mat this week.`],
    RETURNED: f => [
      `back after ${f.returnGap} days away`,
      `30 seconds: "good to see you back". The 2nd return depends on the 1st.`],
    GHOST: f => [
      `used to come ${wk(f.baselinePerWeek)}x/week, nothing for ${f.daysSince} days`,
      `Personal message. No guilt, no offer.`],
    NEW_UNSEEN: f => [
      `new, ${f.totalClasses} classes, no individual feedback from you yet`,
      `2 minutes of feedback after class.`],
    QUIET_RELIABLE: f => [
      `${f.streakWeeks}-week streak, never had individual feedback from you`,
      `These are the ones who leave without warning. One sentence is enough.`],
    title: g => `THE BRIEF — ${g}`,
    sub: 'Who to talk to this week',
    none: 'No signal this week. Everyone is on their usual rhythm.',
    ask: 'Just reply with numbers: 1 SPOKE · 2 NO TIME · 3 LOST',
    stale: n => `${n} student(s) unseen for 60+ days — separate win-back campaign, not this brief.`,
    report: 'WHAT HAPPENED LAST WEEK',
    reportLine: (spoke, back) => `You spoke to ${spoke}. ${back} came back on the mat.`,
    reportValue: v => `About $${v} of monthly revenue kept.`,
    analysed: n => `${n} students analysed`,
    benched: n => `${n} flagged in previous weeks, paused (anti-fatigue).`,
    facts: 'facts',
    returned: 'Back on the mat',
  },
};

// ------------------------------------------------------------------ selection
function buildBrief(students, ref, notes, history) {
  const enriched = students.map(s => ({ ...s, facts: computeFacts(s, ref, notes) }));
  const stale = enriched.filter(s => s.facts.daysSince > CFG.maxDaysSince).length;

  const candidates = [];
  for (const s of enriched) {
    if (s.facts.daysSince > CFG.maxDaysSince) continue;
    for (const rule of RULES) {
      if (rule.when(s.facts)) { candidates.push({ ...s, rule }); break; }
    }
  }

  // anti-fatigue : signale dans les N derniers briefs et toujours pas revenu
  const recent = history.slice(-CFG.coolDownBriefs);
  const isFatigued = s => recent.length === CFG.coolDownBriefs &&
    recent.every(b => b.flagged.some(f => f.id === s.id)) &&
    s.facts.lastSeen < recent[0].refTs;

  const fresh = candidates.filter(s => !isFatigued(s));
  const benched = candidates.filter(isFatigued);

  fresh.sort((a, b) =>
    a.rule.tier - b.rule.tier ||
    b.facts.baselinePerWeek - a.facts.baselinePerWeek ||
    b.facts.daysSince - a.facts.daysSince);

  const picked = [];
  const perRule = {};
  for (const s of fresh) {
    const n = perRule[s.rule.code] || 0;
    if (n >= CFG.perRuleCap) continue;
    perRule[s.rule.code] = n + 1;
    picked.push(s);
    if (picked.length >= CFG.top) break;
  }
  return { picked, benched, stale, enriched, totalActive: enriched.length };
}

// ------------------------------------------- rapport de valeur (la boucle)
function valueReport(history, enriched, feedback, arpu) {
  const last = history[history.length - 1];
  if (!last || !feedback.length) return null;
  const spoke = feedback.filter(f => f.brief_date === last.date && f.action === 'spoke');
  if (!spoke.length) return null;
  const byId = new Map(enriched.map(s => [s.id, s]));
  // verification objective : presence effective APRES la date du brief
  const back = spoke.filter(f => {
    const s = byId.get(f.student_id);
    return s && s.facts.lastSeen > last.refTs;
  });
  return {
    spoke: spoke.length,
    back: back.length,
    names: back.map(f => (byId.get(f.student_id) || {}).name).filter(Boolean),
    value: back.length * arpu,
  };
}

// --------------------------------------------------------------------- sorties
function renderText(b, L, gym, ref, vr) {
  const date = new Date(ref).toISOString().slice(0, 10);
  const out = [`*${L.title(gym)}* — ${date}`, `_${L.sub}_`, ''];
  if (vr) {
    out.push(`[OK] *${L.report}*`, L.reportLine(vr.spoke, vr.back));
    if (vr.names.length) out.push(vr.names.join(', '));
    if (vr.value) out.push(L.reportValue(vr.value));
    out.push('');
  }
  if (!b.picked.length) out.push(L.none);
  b.picked.forEach((s, i) => {
    const [why, action] = COPY[L.code][s.rule.code](s.facts);
    out.push(`*${i + 1}. ${s.name}*`, why, `-> ${action}`, '');
  });
  if (b.picked.length) out.push(L.ask);
  if (b.stale) out.push('', `_${L.stale(b.stale)}_`);
  return out.join('\n');
}

function renderMarkdown(b, L, gym, ref, vr, src) {
  const date = new Date(ref).toISOString().slice(0, 10);
  const out = [`# ${L.title(gym)}`, '', `**${L.sub}** · ${date}`, ''];
  if (vr) {
    out.push(`## ${L.report}`, '', L.reportLine(vr.spoke, vr.back), '');
    if (vr.names.length) out.push(`${L.returned} : **${vr.names.join(', ')}**`, '');
    if (vr.value) out.push(`_${L.reportValue(vr.value)}_`, '');
  }
  if (!b.picked.length) out.push(`_${L.none}_`, '');
  b.picked.forEach((s, i) => {
    const [why, action] = COPY[L.code][s.rule.code](s.facts);
    const f = s.facts;
    out.push(
      `## ${i + 1}. ${s.name}`, '',
      `**${why}**`, '',
      `-> ${action}`, '',
      `<details><summary>${L.facts}</summary>`, '',
      '| fait | valeur |', '|---|---|',
      ...s.rule.uses.map(k => `| \`${k}\` | ${f[k]} |`),
      `| \`lastSeen\` | ${new Date(f.lastSeen).toISOString().slice(0, 10)} |`,
      `| \`rule\` | \`${s.rule.code}\` |`, '',
      '</details>', '');
  });
  out.push('---', '', `_${L.analysed(b.totalActive)} · source : \`${path.basename(src)}\`_`);
  if (b.stale) out.push('', `_${L.stale(b.stale)}_`);
  if (b.benched.length) out.push('', `_${L.benched(b.benched.length)}_`);
  return out.join('\n');
}

// ------------------------------------------------------------------------ main
function usage() {
  console.error(`
CoachOS V0 — generateur de brief

  node brief.mjs <presences.csv> [options]

  --gym "Nom"          nom de l'academie (defaut : nom du fichier)
  --lang fr|en         langue du brief (defaut : fr)
  --date YYYY-MM-DD    date de reference (defaut : aujourd'hui)
  --notes <fichier>    CSV de notes : student_id,date,note
  --feedback <fichier> CSV de retours : brief_date,student_id,action
  --arpu 100           revenu mensuel moyen par eleve (rapport de valeur)
  --top 5              nombre d'eleves dans le brief
  --out <dossier>      dossier de sortie (defaut : ./out)
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) { usage(); process.exit(1); }
  if (!fs.existsSync(file)) { console.error(`Fichier introuvable : ${file}`); process.exit(1); }

  const lang = args.lang === 'en' ? 'en' : 'fr';
  LANG = lang;
  const L = { ...COPY[lang], code: lang };
  const gym = (args.gym && args.gym !== true) ? args.gym : path.basename(file, '.csv');
  const slug = gym.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const outDir = (args.out && args.out !== true) ? args.out : path.join(HERE, 'out');
  const arpu = Number(args.arpu) || 100;
  if (args.top) CFG.top = Number(args.top) || CFG.top;

  const now = new Date();
  const ref = (args.date && args.date !== true)
    ? parseDate(args.date, false)
    : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const { students, skipped, columns } = loadAttendance(file);
  const notes = loadNotes(args.notes !== true ? args.notes : null);

  fs.mkdirSync(outDir, { recursive: true });
  const histFile = path.join(outDir, `${slug}-history.json`);
  const history = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : [];

  const fbPath = (args.feedback && args.feedback !== true) ? args.feedback : path.join(outDir, `${slug}-feedback.csv`);
  const feedback = fs.existsSync(fbPath) ? parseCSV(fs.readFileSync(fbPath, 'utf8')) : [];

  const b = buildBrief(students, ref, notes, history);
  const vr = valueReport(history, b.enriched, feedback, arpu);

  const date = new Date(ref).toISOString().slice(0, 10);
  const base = path.join(outDir, `${slug}-${date}`);
  const txt = renderText(b, L, gym, ref, vr);
  fs.writeFileSync(`${base}.txt`, txt);
  fs.writeFileSync(`${base}.md`, renderMarkdown(b, L, gym, ref, vr, file));
  fs.writeFileSync(`${base}.json`, JSON.stringify({
    gym, date, generatedAt: new Date().toISOString(), source: file, columns,
    config: CFG, totalActive: b.totalActive, staleOver60d: b.stale,
    valueReport: vr,
    flagged: b.picked.map(s => ({ id: s.id, name: s.name, rule: s.rule.code, facts: s.facts })),
  }, null, 2));

  // historique : alimente l'anti-fatigue et le rapport de valeur de la semaine suivante
  const entry = { date, refTs: ref, flagged: b.picked.map(s => ({ id: s.id, name: s.name, rule: s.rule.code })) };
  const idx = history.findIndex(h => h.date === date);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  fs.writeFileSync(histFile, JSON.stringify(history, null, 2));

  // feuille de retour, a completer apres la reponse du coach
  const fbFile = path.join(outDir, `${slug}-feedback.csv`);
  if (!fs.existsSync(fbFile)) fs.writeFileSync(fbFile, 'brief_date,student_id,student_name,action\n');
  const already = new Set(feedback.filter(f => f.brief_date === date).map(f => f.student_id));
  const toAppend = b.picked.filter(s => !already.has(s.id));
  if (toAppend.length) {
    fs.appendFileSync(fbFile, toAppend.map(s => `${date},${s.id},"${s.name}",\n`).join(''));
  }

  console.log(txt);
  console.log('\n' + '-'.repeat(64));
  console.log(`${b.totalActive} eleves | ${b.picked.length} signales | ${b.benched.length} en pause | ${b.stale} >60j` +
    (skipped ? ` | ${skipped} lignes ignorees` : ''));
  console.log(`-> ${base}.txt   (a copier dans WhatsApp)`);
  console.log(`-> ${base}.md    (ton dossier)`);
  console.log(`-> ${fbFile}   (a remplir : spoke | skipped | lost)`);
}

main();
