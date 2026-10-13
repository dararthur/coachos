#!/usr/bin/env node
/**
 * Genere une academie synthetique pour tester brief.mjs.
 *
 * Donnees 100 % fictives. Chaque archetype existe pour declencher une regle
 * precise de RULES.md — c'est le jeu de test du moteur.
 *
 *   node make-demo.mjs            -> data/demo-academy.csv (fin = aujourd'hui)
 *   node make-demo.mjs 2026-09-07 -> fin = cette date
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// PRNG deterministe : le meme fichier a chaque execution
let seed = 20260904;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const arg = process.argv[2];
const now = arg ? new Date(arg + 'T00:00:00Z') : new Date();
const END = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

const FIRST = ['Arthur', 'Thomas', 'Julie', 'Marc', 'Sofia', 'Karim', 'Elena', 'Hugo', 'Lea', 'Yanis',
  'Camille', 'Nadia', 'Pierre', 'Ines', 'Bastien', 'Maya', 'Oscar', 'Rita', 'Samir', 'Chloe',
  'Victor', 'Amina', 'Louis', 'Tess', 'Rayan', 'Manon', 'Diego', 'Jade', 'Noam', 'Alice',
  'Bilal', 'Clara', 'Enzo', 'Fanny', 'Gabin', 'Hana', 'Ilan', 'Jonas', 'Kenza', 'Liam',
  'Malik', 'Nora', 'Otto', 'Paulin', 'Quentin', 'Remi', 'Sarah', 'Tarek', 'Ugo', 'Vera',
  'Wassim', 'Xavier', 'Yasmine', 'Zoe', 'Adrien', 'Bella', 'Cyril', 'Dina', 'Elias', 'Flore'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Robert', 'Petit', 'Durand', 'Leroy', 'Moreau',
  'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux',
  'Vincent', 'Fournier', 'Morel', 'Girard'];

const CLASSES = ['Gi Fundamentals', 'Gi Advanced', 'No-Gi', 'Open Mat', 'Competition'];

// Archetypes : chacun cible une regle de RULES.md
const PLAN = [
  { type: 'regular',      n: 22, note: 'viennent normalement — ne doivent PAS apparaitre' },
  { type: 'casual',       n:  9, note: '1x/sem irregulier — ne doivent PAS apparaitre' },
  { type: 'fading',       n:  3, note: '-> FADING' },
  { type: 'ghost',        n:  4, note: '-> GHOST' },
  { type: 'new_slipping', n:  3, note: '-> NEW_SLIPPING' },
  { type: 'new_active',   n:  4, note: '-> NEW_UNSEEN' },
  { type: 'returner',     n:  2, note: '-> RETURNED' },
  { type: 'streaker',     n:  3, note: '-> QUIET_RELIABLE' },
  { type: 'long_gone',    n:  6, note: '> 60 jours : hors brief, comptes en annexe' },
];

// Genere des presences entre startDaysAgo et stopDaysAgo, a la frequence perWeek
function sessions(startDaysAgo, stopDaysAgo, perWeek) {
  const out = [];
  for (let d = startDaysAgo; d > stopDaysAgo; d--) {
    const ts = END - d * DAY;
    const dow = new Date(ts).getUTCDay();
    if (dow === 0) continue;                       // pas de cours le dimanche
    if (rnd() < perWeek / 6) out.push(ts);         // 6 jours ouvres de tatami
  }
  return out;
}

const rows = [];
let i = 0;
const legend = [];

for (const group of PLAN) {
  for (let k = 0; k < group.n; k++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const id = `S${String(1000 + i).padStart(4, '0')}`;
    i++;
    let dates = [];

    switch (group.type) {
      case 'regular':
        dates = sessions(120, 0, 2 + Math.floor(rnd() * 3));
        break;
      case 'casual':
        dates = sessions(150, 0, 1);
        break;
      case 'fading':                                    // 3x/sem -> 0,5x/sem
        dates = [...sessions(120, 18, 3), ...sessions(18, 1, 0.5)];
        break;
      case 'ghost': {                                   // regulier puis arret net
        const stop = 12 + Math.floor(rnd() * 25);       // 12 a 36 jours
        dates = sessions(140, stop, 2 + Math.floor(rnd() * 2));
        break;
      }
      case 'new_slipping': {                            // arrive il y a ~4 sem, disparu
        const stop = 8 + Math.floor(rnd() * 8);
        dates = sessions(28, stop, 3);
        break;
      }
      case 'new_active':
        dates = sessions(20, 0, 3);
        break;
      case 'returner': {                                // coupure ~30j, revenu cette semaine
        dates = [...sessions(150, 35, 3), END - 3 * DAY, END - 1 * DAY];
        break;
      }
      case 'streaker':                                  // assidu, longue serie
        dates = sessions(200, 0, 3);
        break;
      case 'long_gone':
        dates = sessions(300, 75 + Math.floor(rnd() * 60), 3);
        break;
    }

    dates = [...new Set(dates)].sort((a, b) => a - b);
    if (!dates.length) continue;
    legend.push({ id, name, archetype: group.type, classes: dates.length });
    for (const ts of dates) {
      rows.push([id, name, new Date(ts).toISOString().slice(0, 10), CLASSES[Math.floor(rnd() * CLASSES.length)]]);
    }
  }
}

rows.sort((a, b) => a[2].localeCompare(b[2]));

const csv = 'student_id,student_name,date,class\n' +
  rows.map(r => `${r[0]},"${r[1]}",${r[2]},"${r[3]}"`).join('\n') + '\n';

fs.mkdirSync(path.join(HERE, 'data'), { recursive: true });
const outFile = path.join(HERE, 'data', 'demo-academy.csv');
fs.writeFileSync(outFile, csv);
fs.writeFileSync(path.join(HERE, 'data', 'demo-academy.legend.json'),
  JSON.stringify({ endDate: new Date(END).toISOString().slice(0, 10), plan: PLAN, students: legend }, null, 2));

console.log(`${outFile}`);
console.log(`${legend.length} eleves | ${rows.length} presences | fin ${new Date(END).toISOString().slice(0, 10)}`);
for (const g of PLAN) console.log(`  ${String(g.n).padStart(3)} ${g.type.padEnd(14)} ${g.note}`);
