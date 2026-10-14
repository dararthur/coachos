import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing, type TestUser } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

async function member(academy: string, label: string) {
  const user = await createUser(label);
  await addMember(academy, user, "member");
  const person = await createPerson(academy, label, "Fixe");
  await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
  return { user, person };
}
const keyOf = async (academy: string) => (await adminSql()<{ key: string }[]>`select key from public.academy_checkin_keys where academy_id = ${academy}`)[0]!.key;
const setFixed = (academy: string, before = 45, after = 30) => adminSql()`update public.academies set checkin_mode = 'fixed', checkin_before_minutes = ${before}, checkin_after_minutes = ${after} where id = ${academy}`;
const peek = (u: TestUser, key: string) => asUser(u, (tx) => tx<{ r: { sessions: { session_id: string; booking: string | null }[] } }[]>`select public.checkin_fixed_peek(${key}) as r`).then((r) => r[0]!.r);
const redeem = (u: TestUser, key: string, session: string, book = false) =>
  asUser(u, (tx) => tx<{ r: { result: string } }[]>`select public.checkin_fixed_redeem(${key}, ${session}, ${book}) as r`).then((r) => r[0]!.r);
const book = (u: TestUser, session: string) => asUser(u, (tx) => tx`select public.book_session(${session})`);

describe("pointage par QR fixe du club", () => {
  it("chaque club reçoit une clé secrète, lisible du staff seulement", async () => {
    const owner = await createUser("fx-owner");
    const academy = await createAcademy(owner);
    expect(await keyOf(academy)).toMatch(/^[a-f0-9]{24}$/);
    const a = await member(academy, "fx-a");
    expect(await asUser(owner, (tx) => tx`select key from public.academy_checkin_keys`)).toHaveLength(1);
    expect(await asUser(a.user, (tx) => tx`select key from public.academy_checkin_keys`)).toHaveLength(0);
  });

  it("refuse tant que le club est en mode tournant, pour une clé inconnue et pour un non-membre", async () => {
    const owner = await createUser("fx2-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "fx2-a");
    const key = await keyOf(academy);
    await createSession(academy, { startsAt: at(5) });
    await expect(failing(() => peek(a.user, key))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
    await setFixed(academy);
    expect((await peek(a.user, key)).sessions).toHaveLength(1);
    await expect(failing(() => peek(a.user, "0".repeat(24)))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
    const stranger = await createUser("fx2-stranger");
    await expect(failing(() => peek(stranger, key))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
  });

  it("retrouve la séance par l'heure : fenêtre avant/après, séances annulées ou validées exclues", async () => {
    const owner = await createUser("fx3-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "fx3-a");
    const key = await keyOf(academy);
    await setFixed(academy, 45, 30);
    const soon = await createSession(academy, { startsAt: at(40) }); // dans la fenêtre « avant »
    await createSession(academy, { startsAt: at(50) }); // trop tôt
    const started = await createSession(academy, { startsAt: at(-20) }); // commencée depuis 20 min
    await createSession(academy, { startsAt: at(-40) }); // plus de 30 min après le début
    await createSession(academy, { startsAt: at(10), status: "cancelled" });
    const validated = await createSession(academy, { startsAt: at(5) });
    await adminSql()`insert into public.session_checkins (session_id, academy_id, status, validated_at) values (${validated}, ${academy}, 'closed', now())`;
    const ids = (await peek(a.user, key)).sessions.map((s) => s.session_id);
    expect(ids).toEqual([started, soon]);
    // La fenêtre est réglable par le club.
    await setFixed(academy, 60, 60);
    expect((await peek(a.user, key)).sessions).toHaveLength(4);
  });

  it("sans cours pointable, indique le prochain cours et l'ouverture du pointage (jamais à un non-membre)", async () => {
    const owner = await createUser("fx5-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "fx5-a");
    const key = await keyOf(academy);
    await setFixed(academy, 45, 30);
    await createSession(academy, { startsAt: at(300), status: "cancelled" });
    const later = await createSession(academy, { startsAt: at(240) });
    await createSession(academy, { startsAt: at(480) });
    type Peek = { sessions: unknown[]; before_minutes: number; next: { class_name: string; starts_at: string } | null };
    const r = (await peek(a.user, key)) as unknown as Peek;
    expect(r.sessions).toHaveLength(0);
    expect(r.before_minutes).toBe(45);
    const starts_at = (await adminSql()<{ starts_at: Date }[]>`select starts_at from public.sessions where id = ${later}`)[0]!.starts_at;
    expect(new Date(r.next!.starts_at).getTime()).toBe(starts_at.getTime());
    expect(r.next!.class_name).toBeTruthy();
    // Un cours déjà pointable n'est pas « le prochain » : il figure dans les séances.
    await createSession(academy, { startsAt: at(10) });
    const open = (await peek(a.user, key)) as unknown as Peek;
    expect(open.sessions).toHaveLength(1);
    expect(new Date(open.next!.starts_at).getTime()).toBe(starts_at.getTime());
    // Les contrôles d'accès précèdent toute lecture du planning.
    const stranger = await createUser("fx5-stranger");
    await expect(failing(() => peek(stranger, key))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
  });

  it("la réservation est obligatoire ; une réservation existante est respectée ; le choix se fait entre séances qui se chevauchent", async () => {
    const owner = await createUser("fx4-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "fx4-a");
    const key = await keyOf(academy);
    await setFixed(academy);
    const first = await createSession(academy, { startsAt: at(-5) });
    const second = await createSession(academy, { startsAt: at(5) });
    // Aucune réservation : refus, puis « réserver et pointer ».
    await expect(failing(() => redeem(a.user, key, first))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_no_booking") });
    // Réservé à la seconde : elle passe en tête de liste.
    await book(a.user, second);
    const sessions = (await peek(a.user, key)).sessions;
    expect(sessions.map((s) => [s.session_id, s.booking])).toEqual([[second, "booked"], [first, null]]);
    expect(await redeem(a.user, key, second)).toMatchObject({ result: "recorded" });
    expect(await redeem(a.user, key, second)).toMatchObject({ result: "already" });
    expect(await redeem(a.user, key, first, true)).toMatchObject({ result: "recorded" });
    const rows = await adminSql()<{ source: string }[]>`select source from public.attendance where person_id = ${a.person}`;
    expect(rows.map((r) => r.source)).toEqual(["qr", "qr"]);
  });

  it("séance pleine : liste d'attente conservée, sans pointage ; séance hors fenêtre ou validée refusée", async () => {
    const owner = await createUser("fx5-owner");
    const academy = await createAcademy(owner);
    const a = await member(academy, "fx5-a");
    const b = await member(academy, "fx5-b");
    const key = await keyOf(academy);
    await setFixed(academy);
    const full = await createSession(academy, { startsAt: at(2) });
    await adminSql()`update public.sessions set capacity = 1 where id = ${full}`;
    await book(a.user, full);
    expect(await redeem(b.user, key, full, true)).toMatchObject({ result: "waitlisted" });
    expect(await adminSql()`select 1 from public.attendance where person_id = ${b.person}`).toHaveLength(0);
    expect((await adminSql()<{ status: string }[]>`select status from public.session_bookings where person_id = ${b.person}`)[0]!.status).toBe("waitlisted");
    const late = await createSession(academy, { startsAt: at(-90) });
    await expect(failing(() => redeem(a.user, key, late, true))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
    await adminSql()`insert into public.session_checkins (session_id, academy_id, status, validated_at) values (${full}, ${academy}, 'closed', now())`;
    await expect(failing(() => redeem(a.user, key, full))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
  });

  it("réglages et régénération réservés aux administrateurs ; l'ancienne clé cesse de fonctionner", async () => {
    const owner = await createUser("fx6-owner");
    const academy = await createAcademy(owner);
    const coach = await createUser("fx6-coach");
    await addMember(academy, coach, "coach");
    const a = await member(academy, "fx6-a");
    await createSession(academy, { startsAt: at(5) });
    await expect(failing(() => asUser(coach, (tx) => tx`select public.set_checkin_settings(${academy}, 'fixed', 45, 30)`))).resolves.toMatchObject({ code: "42501" });
    await expect(failing(() => asUser(coach, (tx) => tx`select public.regenerate_checkin_key(${academy})`))).resolves.toMatchObject({ code: "42501" });
    await expect(failing(() => asUser(owner, (tx) => tx`select public.set_checkin_settings(${academy}, 'weird', 45, 30)`))).resolves.toMatchObject({ message: expect.stringContaining("coachos:validation") });
    await expect(failing(() => asUser(owner, (tx) => tx`select public.set_checkin_settings(${academy}, 'fixed', 999, 30)`))).resolves.toMatchObject({ message: expect.stringContaining("coachos:validation") });
    await asUser(owner, (tx) => tx`select public.set_checkin_settings(${academy}, 'fixed', 30, 15)`);
    const [row] = await adminSql()<{ checkin_mode: string; checkin_before_minutes: number; checkin_after_minutes: number }[]>`select checkin_mode, checkin_before_minutes, checkin_after_minutes from public.academies where id = ${academy}`;
    expect(row).toEqual({ checkin_mode: "fixed", checkin_before_minutes: 30, checkin_after_minutes: 15 });
    const old = await keyOf(academy);
    await asUser(owner, (tx) => tx`select public.regenerate_checkin_key(${academy})`);
    expect(await keyOf(academy)).not.toBe(old);
    await expect(failing(() => peek(a.user, old))).resolves.toMatchObject({ message: expect.stringContaining("coachos:checkin_invalid") });
    expect((await peek(a.user, await keyOf(academy))).sessions).toHaveLength(1);
  });
});
