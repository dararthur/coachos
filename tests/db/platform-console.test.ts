import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const registerAdmin = (id: string) => appSql()`select app_private.register_platform_admin(${id})`;

describe("console d'administration de la plateforme", () => {
  it("seul l'administrateur désigné lit la liste des clubs et la vue d'ensemble ; tout autre compte, même propriétaire d'un club, est refusé", async () => {
    const admin = await createUser("console-admin");
    const owner = await createUser("console-owner");
    await createAcademy(owner, "Club console refus");
    await registerAdmin(admin.id);

    for (const sql of ["select * from public.admin_list_clubs()", "select * from public.admin_overview()"]) {
      expect((await failing(() => asUser(owner, (tx) => tx.unsafe(sql)))).code).toBe("42501");
    }
    expect(await asUser(admin, (tx) => tx`select * from public.admin_overview()`)).toHaveLength(1);
    // Sans connexion : la fonction n'est même pas exécutable.
    expect((await failing(() => appSql()`select * from public.admin_list_clubs()`)).message).toMatch(/permission denied/);
  });

  it("la liste donne des compteurs par club et le contact du propriétaire, sans aucune donnée de membre", async () => {
    const admin = await createUser("console-admin2");
    const owner = await createUser("console-owner2");
    const club = await createAcademy(owner, "Club console compteurs");
    await createPerson(club, "Ana", "Secrète");
    await createPerson(club, "Bob", "Confidentiel");
    await registerAdmin(admin.id);

    const rows = await asUser(admin, (tx) => tx<Record<string, unknown>[]>`select * from public.admin_list_clubs()`);
    const row = rows.find((r) => r.id === club);
    expect(row).toMatchObject({ name: "Club console compteurs", owner_email: owner.email, members: 2, staff: 1, events_7d: 0, last_event_at: null });
    // La réponse ne porte que les colonnes prévues : aucun nom ni adresse de membre.
    expect(Object.keys(row!).sort()).toEqual(
      ["created_at", "disabled_features", "events_30d", "events_prev_30d", "plan_name", "price_cents", "renews_on", "subscription_status", "suspended_at", "events_7d", "id", "last_event_at", "members", "name", "owner_email", "sessions_30d", "staff", "timezone"].sort(),
    );
    expect(JSON.stringify(rows)).not.toMatch(/Secrète|Confidentiel/);
  });

  it("la vue d'ensemble compte les événements d'usage par type, tous clubs confondus", async () => {
    const admin = await createUser("console-admin3");
    const owner = await createUser("console-owner3");
    const club = await createAcademy(owner, "Club console usage");
    await registerAdmin(admin.id);
    const before = await asUser(admin, (tx) => tx<{ events_7d: number; by_event: Record<string, number> }[]>`select events_7d, by_event from public.admin_overview()`);

    await adminSql()`insert into public.usage_events (academy_id, event) values (${club}, 'checkin_qr'), (${club}, 'checkin_qr'), (${club}, 'booking_created')`;
    const after = await asUser(admin, (tx) => tx<{ events_7d: number; active_clubs_30d: number; by_event: Record<string, number> }[]>`select events_7d, active_clubs_30d, by_event from public.admin_overview()`);
    expect(after[0]!.events_7d - before[0]!.events_7d).toBe(3);
    expect((after[0]!.by_event.checkin_qr ?? 0) - (before[0]!.by_event.checkin_qr ?? 0)).toBe(2);
    expect(after[0]!.active_clubs_30d).toBeGreaterThanOrEqual(1);

    const rows = await asUser(admin, (tx) => tx<{ id: string; events_7d: number; events_30d: number; last_event_at: Date | null }[]>`select id, events_7d, events_30d, last_event_at from public.admin_list_clubs()`);
    const row = rows.find((r) => r.id === club)!;
    expect(row).toMatchObject({ events_7d: 3, events_30d: 3 });
    expect(row.last_event_at).toBeInstanceOf(Date);
  });
});
