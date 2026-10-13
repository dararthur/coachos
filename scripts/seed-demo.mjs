// Données de démonstration 100 % SYNTHÉTIQUES, pour un club créé via l'interface (aucun mot de passe, aucun compte).
//
//   SEED_DATABASE_URL=postgresql://postgres:...@127.0.0.1:54322/postgres npm run db:seed-demo -- --academy <uuid>
//   npm run db:seed-demo -- --academy <uuid> --purge     (retire les données de démonstration)
//
// - Réservé à une base LOCALE (127.0.0.1 / localhost) sauf --allow-remote (déconseillé).
// - Membres : identifiant d'origine « demo-NNN », e-mails en @example.invalid.
// - Séances : note « [DÉMO SYNTHÉTIQUE] » visible dans le planning.
import postgres from "postgres";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.SEED_DATABASE_URL;
const academy = value("academy");
if (!url || !academy || !/^[0-9a-f-]{36}$/i.test(academy)) {
  console.error("Usage : SEED_DATABASE_URL=<url superutilisateur local> npm run db:seed-demo -- --academy <uuid> [--purge]");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) && !flag("allow-remote")) {
  console.error(`Refus : ${host} n'est pas une base locale. Ces données sont destinées au développement uniquement.`);
  process.exit(2);
}

const NOTE = "[DÉMO SYNTHÉTIQUE]";
const sql = postgres(url, { max: 1, onnotice: () => {} });

if (flag("purge")) {
  const s = await sql`delete from public.sessions where academy_id = ${academy} and notes = ${NOTE}`.catch(() => null);
  await sql`delete from public.attendance a using public.people p where a.person_id = p.id and p.academy_id = ${academy} and p.external_ref like 'demo-%'`;
  const p = await sql`delete from public.people where academy_id = ${academy} and external_ref like 'demo-%'`;
  console.log(`Purge : ${p.count} membres et ${s?.count ?? 0} séances de démonstration supprimés.`);
  await sql.end();
  process.exit(0);
}

// PRNG déterministe : mêmes données à chaque exécution.
let seed = 20261013;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

const FIRST = ["Léa", "Hugo", "Inès", "Nolan", "Camille", "Yanis", "Manon", "Lucas", "Jade", "Mathis", "Sofia", "Tom", "Clara", "Adam", "Zoé", "Enzo", "Lina", "Paul", "Nina", "Axel"];
const LAST = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier"];

const [exists] = await sql`select id, timezone from public.academies where id = ${academy}`;
if (!exists) {
  console.error("Académie introuvable.");
  process.exit(1);
}
const [classType] = await sql`select id from public.class_types where academy_id = ${academy} and archived_at is null order by created_at limit 1`;
if (!classType) {
  console.error("Aucun type de cours : créez-en un dans les paramètres.");
  process.exit(1);
}

const members = [];
for (let i = 1; i <= 40; i++) {
  const first = pick(FIRST);
  const last = pick(LAST);
  const ref = `demo-${String(i).padStart(3, "0")}`;
  const [row] = await sql`
    insert into public.people (academy_id, first_name, last_name, email, joined_on, external_ref)
    values (${academy}, ${first}, ${last}, ${`${ref}@example.invalid`}, (current_date - ((90 + floor(random() * 500))::int)), ${ref})
    on conflict do nothing returning id`;
  if (row) members.push({ id: row.id, assiduity: 0.25 + rand() * 0.7, lapsedAfterWeek: i % 9 === 0 ? 5 + Math.floor(rand() * 3) : 0 });
}
if (members.length === 0) {
  console.log("Les données de démonstration existent déjà (utilisez --purge pour les retirer).");
  await sql.end();
  process.exit(0);
}

// 8 semaines de cours (lundi/mercredi/vendredi 19:00 Paris), jusqu'à aujourd'hui.
const sessions = [];
const today = new Date();
for (let w = 8; w >= 0; w--) {
  for (const dow of [1, 3, 5]) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - w * 7));
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + (dow - 1));
    if (day > today) continue;
    const date = day.toISOString().slice(0, 10);
    const [s] = await sql`
      insert into public.sessions (academy_id, class_type_id, starts_at, ends_at, notes)
      select ${academy}, ${classType.id}, (${date}::date + time '19:00') at time zone a.timezone,
             (${date}::date + time '20:00') at time zone a.timezone, ${NOTE}
      from public.academies a where a.id = ${academy}
      on conflict do nothing returning id`;
    if (s) sessions.push({ id: s.id, weeksAgo: w });
  }
}

let records = 0;
for (const s of sessions) {
  for (const m of members) {
    if (s.weeksAgo < m.lapsedAfterWeek) continue; // membres « décrocheurs » : plus venus depuis quelques semaines
    const r = rand();
    const status = r < m.assiduity * 0.9 ? "present" : r < m.assiduity ? "late" : null;
    if (!status) continue;
    await sql`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${s.id}, ${m.id}, ${status}) on conflict do nothing`;
    records++;
  }
}
// Quelques membres archivés pour montrer le filtre.
await sql`update public.people set archived_at = now() - interval '40 days' where academy_id = ${academy} and external_ref in ('demo-007', 'demo-019')`;

console.log(`Démo synthétique créée : ${members.length} membres, ${sessions.length} séances, ${records} présences.`);
await sql.end();
