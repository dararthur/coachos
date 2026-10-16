import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

/** Formule et facturation (migration 001400) : interne à la plateforme, lue et écrite par l'administrateur seul. */
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

const set = (admin: { id: string }, club: string, over: Partial<{ plan: string; status: string; starts: string | null; renews: string | null; price: number | null; note: string | null }> = {}) => {
  const v = { plan: "Club", status: "active", starts: "2026-09-01", renews: "2026-10-01", price: 4900, note: null as string | null, ...over };
  return asUser(admin, (tx) => tx`select public.admin_set_club_subscription(${club}, ${v.plan}, ${v.status}, ${v.starts}::date, ${v.renews}::date, ${v.price}::integer, ${v.note})`);
};

describe("formule d'un club", () => {
  it("aucune formule au départ ; enregistrement, relecture, puis mise à jour (une seule ligne par club)", async () => {
    const t = await setup("sub1");
    expect(await asUser(t.admin, (tx) => tx`select * from public.admin_club_subscription(${t.club})`)).toHaveLength(0);
    await set(t.admin, t.club, { plan: "  Pilote  ", status: "trial", price: null, note: "  Appelé le 12/10  " });
    const [row] = await asUser(t.admin, (tx) => tx<Record<string, unknown>[]>`select plan_name, status, starts_on::text, renews_on::text, price_cents, note from public.admin_club_subscription(${t.club})`);
    expect(row).toEqual({ plan_name: "Pilote", status: "trial", starts_on: "2026-09-01", renews_on: "2026-10-01", price_cents: null, note: "Appelé le 12/10" });
    await set(t.admin, t.club, { plan: "Club", status: "active", price: 4900, note: "" });
    const rows = await asUser(t.admin, (tx) => tx<{ plan_name: string; note: string | null; price_cents: number }[]>`select plan_name, note, price_cents from public.admin_club_subscription(${t.club})`);
    expect(rows).toEqual([{ plan_name: "Club", note: null, price_cents: 4900 }]);
    expect(await adminSql()`select 1 from public.club_subscriptions where academy_id = ${t.club}`).toHaveLength(1);
  });

  it("valeurs refusées : état inconnu, formule vide ou trop longue, échéance avant le début, prix négatif, note trop longue", async () => {
    const t = await setup("sub2");
    for (const bad of [
      { status: "gratuit" },
      { plan: "   " },
      { plan: "x".repeat(61) },
      { starts: "2026-10-01", renews: "2026-09-01" },
      { price: -1 },
      { price: 2_000_000 },
      { note: "n".repeat(501) },
    ]) {
      expect((await failing(() => set(t.admin, t.club, bad))).message).toContain("coachos:validation");
    }
    // Début ou échéance seuls sont acceptés.
    await set(t.admin, t.club, { starts: null, renews: "2026-12-01" });
    await set(t.admin, t.club, { starts: "2026-09-01", renews: null });
  });

  it("la liste des clubs porte la formule ; un club sans formule a des valeurs vides", async () => {
    const t = await setup("sub3");
    const bare = await createUser("sub3-owner2");
    const bareClub = await createAcademy(bare, "Club sub3 nu");
    await set(t.admin, t.club, { plan: "Pro", status: "overdue", renews: "2026-11-05", price: 9900 });
    const rows = await asUser(t.admin, (tx) => tx<{ id: string; plan_name: string | null; subscription_status: string | null; renews_on: string | null; price_cents: number | null }[]>`
      select id, plan_name, subscription_status, renews_on::text, price_cents from public.admin_list_clubs()`);
    expect(rows.find((r) => r.id === t.club)).toMatchObject({ plan_name: "Pro", subscription_status: "overdue", renews_on: "2026-11-05", price_cents: 9900 });
    expect(rows.find((r) => r.id === bareClub)).toMatchObject({ plan_name: null, subscription_status: null, renews_on: null, price_cents: null });
  });

  it("un club inexistant est refusé ; supprimer le club supprime sa formule", async () => {
    const t = await setup("sub4");
    expect((await failing(() => set(t.admin, "00000000-0000-4000-8000-000000000000"))).message).toContain("coachos:not_found");
    await set(t.admin, t.club);
    await adminSql()`delete from public.academies where id = ${t.club}`;
    expect(await adminSql()`select 1 from public.club_subscriptions where academy_id = ${t.club}`).toHaveLength(0);
  });

  it("réservée à l'administrateur de la plateforme : ni le propriétaire du club, ni un membre, ni une lecture directe", async () => {
    const t = await setup("sub5");
    await set(t.admin, t.club);
    expect((await failing(() => set(t.owner, t.club))).code).toBe("42501");
    expect((await failing(() => asUser(t.owner, (tx) => tx`select * from public.admin_club_subscription(${t.club})`))).code).toBe("42501");
    expect((await failing(() => asUser(t.owner, (tx) => tx`select * from public.club_subscriptions`))).message).toMatch(/permission denied/);
    expect((await failing(() => asUser(t.admin, (tx) => tx`select * from public.club_subscriptions`))).message).toMatch(/permission denied/);
    expect((await failing(() => appSql()`select * from public.admin_club_subscription(${t.club})`)).message).toMatch(/permission denied/);
  });
});
