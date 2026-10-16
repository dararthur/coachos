import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

/** Tendances (migration 001300) : usage des 30 jours précédents et série mensuelle sur 13 mois, réservés à l'administrateur de la plateforme. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

async function setup(label: string) {
  const admin = await createUser(`${label}-admin`);
  await appSql()`select app_private.register_platform_admin(${admin.id})`;
  const owner = await createUser(`${label}-owner`);
  const club = await createAcademy(owner, `Club ${label}`);
  return { admin, owner, club };
}

const addEvents = (club: string, daysAgo: number, event: string, n: number) =>
  adminSql()`insert into public.usage_events (academy_id, event, created_at)
             select ${club}, ${event}, now() - make_interval(days => ${daysAgo}) from generate_series(1, ${n})`;

describe("liste des clubs : usage précédent", () => {
  it("sépare les 30 derniers jours des 30 jours d'avant", async () => {
    const t = await setup("tr1");
    await addEvents(t.club, 3, "checkin_qr", 4); // récent
    await addEvents(t.club, 45, "booking_created", 9); // mois précédent
    await addEvents(t.club, 80, "checkin_qr", 6); // plus ancien : ni l'un ni l'autre
    const rows = await asUser(t.admin, (tx) => tx<{ id: string; events_30d: number; events_prev_30d: number }[]>`select id, events_30d, events_prev_30d from public.admin_list_clubs()`);
    expect(rows.find((r) => r.id === t.club)).toMatchObject({ events_30d: 4, events_prev_30d: 9 });
  });
});

describe("série mensuelle", () => {
  it("regroupe par mois et par type, pour un club ou pour tous, sur 13 mois seulement", async () => {
    const t = await setup("tr2");
    // Un seul administrateur à la fois : le second club n'a que son propriétaire.
    const otherOwner = await createUser("tr2b-owner");
    const otherClub = await createAcademy(otherOwner, "Club tr2b");
    await addEvents(t.club, 2, "checkin_qr", 3);
    await addEvents(t.club, 2, "booking_created", 2);
    await addEvents(otherClub, 2, "checkin_qr", 5);
    await addEvents(t.club, 700, "checkin_qr", 8); // au-delà de 13 mois : exclu

    const mine = await asUser(t.admin, (tx) => tx<{ month: string; event: string; n: number }[]>`select month::text as month, event, n from public.admin_usage_series(${t.club})`);
    expect(mine.reduce((s, r) => s + r.n, 0)).toBe(5);
    expect(new Set(mine.map((r) => r.event))).toEqual(new Set(["checkin_qr", "booking_created"]));
    expect(mine.every((r) => /^\d{4}-\d{2}-01$/.test(r.month))).toBe(true);

    const all = await asUser(t.admin, (tx) => tx<{ n: number }[]>`select n from public.admin_usage_series(null)`);
    expect(all.reduce((s, r) => s + r.n, 0)).toBeGreaterThanOrEqual(10);
  });

  it("réservée à l'administrateur de la plateforme", async () => {
    const t = await setup("tr3");
    expect((await failing(() => asUser(t.owner, (tx) => tx`select * from public.admin_usage_series(${t.club})`))).code).toBe("42501");
    expect((await failing(() => appSql()`select * from public.admin_usage_series(null)`)).message).toMatch(/permission denied/);
  });
});
