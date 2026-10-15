import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { adminSql, asUser, buildWorld, closeAll, type World } from "./support";

/**
 * Isolation entre clubs, table par table, à partir du CATALOGUE : toute table de `public` qui porte `academy_id` est
 * vérifiée, y compris celles ajoutées après coup (une nouvelle table est couverte sans modifier ce test). Complète
 * tenant-isolation.test.ts, dont la liste de tables est écrite à la main.
 */
let w: World;
let tables: string[];

beforeAll(async () => {
  w = await buildWorld();
  const sql = adminSql();
  // Données du club B dans les tables récentes (réservations, actualités, photos, notifications, rappels).
  const [booking] = await sql<{ id: string }[]>`insert into public.session_bookings (academy_id, session_id, person_id, status)
    values (${w.academyB}, ${w.sessionB}, ${w.personB}, 'booked') returning id`;
  await sql`insert into public.booking_notifications (academy_id, booking_id) values (${w.academyB}, ${booking!.id})`;
  await sql`insert into public.club_posts (academy_id, title, body, author_id) values (${w.academyB}, 'Actu B', 'Réservée au club B', ${w.bob.id})`;
  await sql`insert into public.person_photos (person_id, academy_id, content_type, data) values (${w.personB}, ${w.academyB}, 'image/webp', ${Buffer.from([1, 2, 3])})`;
  await sql`insert into public.session_reminders (session_id, academy_id) values (${w.sessionB}, ${w.academyB})`;
  tables = (
    await sql<{ table_name: string }[]>`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'academy_id' and t.table_type = 'BASE TABLE'
      order by 1`
  ).map((r) => r.table_name);
});
afterAll(closeAll);

/** Lignes du club B visibles par `user` ; une table totalement fermée (permission refusée) compte pour 0. */
async function visibleRowsOfB(user: { id: string }, table: string): Promise<number> {
  try {
    const rows = await asUser(user, (tx) => tx.unsafe(`select 1 from public.${table} where academy_id = $1`, [w.academyB]));
    return rows.length;
  } catch (e) {
    if (e instanceof AppError && e.code === "forbidden") return 0;
    throw e;
  }
}

describe("isolation entre clubs : toutes les tables du catalogue", () => {
  it("le catalogue contient bien les tables récentes (le test ne tourne pas à vide)", () => {
    for (const t of ["people", "sessions", "attendance", "session_bookings", "club_posts", "person_photos", "guardianships", "booking_notifications", "session_reminders", "academy_join_codes", "academy_checkin_keys", "academy_logos"]) {
      expect(tables, t).toContain(t);
    }
  });

  it("le club B a bien des données dans les tables récentes (sinon « 0 ligne » ne prouverait rien)", async () => {
    const sql = adminSql();
    for (const t of ["session_bookings", "club_posts", "person_photos", "booking_notifications", "session_reminders", "people", "attendance"]) {
      const [row] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${t} where academy_id = $1`, [w.academyB]);
      expect(row!.n, t).toBeGreaterThan(0);
    }
  });

  for (const actor of ["alice", "adam", "carl", "mia"] as const) {
    it(`${actor} (club A, tous rôles) ne lit aucune ligne du club B, quelle que soit la table`, async () => {
      const leaks: string[] = [];
      for (const table of tables) if ((await visibleRowsOfB(w[actor], table)) > 0) leaks.push(table);
      expect(leaks).toEqual([]);
    });
  }

  it("un compte sans club ne lit rien non plus", async () => {
    const [u] = await adminSql()<{ id: string }[]>`select id from auth.users where id not in (select user_id from public.academy_memberships) limit 1`;
    const outsider = u ?? { id: "00000000-0000-4000-8000-000000000000" };
    const leaks: string[] = [];
    for (const table of tables) if ((await visibleRowsOfB(outsider, table)) > 0) leaks.push(table);
    expect(leaks).toEqual([]);
  });

  it("aucune écriture d'un acteur du club A ne touche une ligne du club B", async () => {
    const sql = adminSql();
    const before = await Promise.all(tables.map(async (t) => (await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${t} where academy_id = $1`, [w.academyB]))[0]!.n));
    for (const table of tables) {
      try {
        await asUser(w.alice, (tx) => tx.unsafe(`delete from public.${table} where academy_id = $1`, [w.academyB]));
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // refus explicite : attendu
      }
    }
    const after = await Promise.all(tables.map(async (t) => (await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${t} where academy_id = $1`, [w.academyB]))[0]!.n));
    expect(after).toEqual(before);
  });
});
