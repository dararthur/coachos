import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { formatDay, formatTime } from "@/domain/dates";
import { deliverBookingPromotions } from "@/server/booking-notifications";
import type { Mailer, MailMessage } from "@/server/mail/types";
import { addMember, adminSql, appSql, asUser, closeAll, createAcademy, createPerson, createSession, createUser, failing, type TestUser } from "./support";

/**
 * E-mail à l'adhérent promu depuis la liste d'attente (migration 0022) : mise en file dans la transaction de la promotion,
 * envoi par app_server, rien pour une place qui n'est plus d'actualité, file fermée à tous les autres rôles.
 */
afterAll(closeAll);

// La base est partagée avec les autres fichiers : on part d'une file vide pour compter exactement.
beforeEach(async () => {
  await adminSql()`delete from public.booking_notifications`;
});

const SITE = "https://club.example";

function recorder(failWith?: Error) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    async send(m) {
      if (failWith) throw failWith;
      sent.push(m);
    },
  };
  return { sent, mailer };
}
const deliver = (mailer: Mailer) => deliverBookingPromotions({ sql: appSql(), mailer, siteUrl: SITE });

async function member(academy: string, label: string) {
  const user = await createUser(label);
  await addMember(academy, user, "member");
  const person = await createPerson(academy, label, "Zeta");
  await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
  return { user, person };
}
type Member = Awaited<ReturnType<typeof member>>;

const book = (u: TestUser, session: string) => asUser(u, (tx) => tx<{ s: string }[]>`select public.book_session(${session}) as s`).then((r) => r[0]!.s);
const cancel = (u: TestUser, session: string) => asUser(u, (tx) => tx`select public.cancel_booking(${session})`);
const setCapacity = (session: string, cap: number | null) => adminSql()`update public.sessions set capacity = ${cap} where id = ${session}`;
const status = async (session: string, person: string) =>
  (await adminSql()<{ status: string }[]>`select status from public.session_bookings where session_id = ${session} and person_id = ${person}`)[0]?.status ?? null;
/** Fiches dont une notification est en file. */
const queued = async () =>
  (await adminSql()<{ person_id: string }[]>`
    select b.person_id from public.booking_notifications n join public.session_bookings b on b.id = n.booking_id order by b.seq`).map((r) => r.person_id);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Club, séance à capacité 1 : `first` inscrit, les suivants en liste d'attente dans l'ordre. */
async function fullClass(label: string, waiting = 1, startsAt = inHours(30)) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const session = await createSession(academy, { startsAt });
  await setCapacity(session, 1);
  const first = await member(academy, `${label}-first`);
  expect(await book(first.user, session)).toBe("booked");
  const waitlist: Member[] = [];
  for (let i = 0; i < waiting; i++) {
    const m = await member(academy, `${label}-w${i}`);
    expect(await book(m.user, session)).toBe("waitlisted");
    waitlist.push(m);
  }
  return { owner, academy, session, first, waitlist };
}

describe("mise en file dans la transaction de la promotion", () => {
  it("une annulation promeut le premier de la liste : un seul e-mail, à son compte, avec club, cours, horaire du club et lien vers son espace", async () => {
    const { academy, session, first, waitlist } = await fullClass("nt1", 2);
    const [next, after] = waitlist as [Member, Member];
    expect(await queued()).toEqual([]);

    await cancel(first.user, session);
    expect(await status(session, next.person)).toBe("booked");
    expect(await queued()).toEqual([next.person]);

    const { sent, mailer } = recorder();
    expect(await deliver(mailer)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe(next.user.email);
    expect(m.kind).toBe("booking_promoted");
    expect(m.link).toBe(`${SITE}/a/${academy}/me`);

    const [s] = await adminSql()<{ starts_at: Date; class_name: string }[]>`
      select s.starts_at, ct.name as class_name from public.sessions s join public.class_types ct on ct.id = s.class_type_id where s.id = ${session}`;
    for (const expected of [`Club nt1`, s!.class_name, formatDay(s!.starts_at, "Europe/Paris"), formatTime(s!.starts_at, "Europe/Paris"), m.link]) {
      expect(m.text, expected).toContain(expected);
    }
    expect(m.subject).toContain(s!.class_name);
    // Données minimales : ni le nom de l'adhérent, ni les autres inscrits.
    for (const other of ["nt1-w0", "nt1-w1", "nt1-first", "Zeta", first.user.email, after.user.email]) {
      expect(`${m.subject}\n${m.text}\n${m.html}`, other).not.toContain(other);
    }

    expect(await queued()).toEqual([]);
    expect(await deliver(recorder().mailer)).toEqual({ sent: 0, failed: 0 });
    expect(await status(session, after.person)).toBe("waitlisted");
  });

  it("chaque chemin de promotion met en file : capacité augmentée ou retirée, inscrit archivé ou anonymisé, place accordée par le coach", async () => {
    const capacity = await fullClass("nt2a", 3);
    await setCapacity(capacity.session, 2);
    expect(await queued()).toEqual([capacity.waitlist[0]!.person]);
    await setCapacity(capacity.session, null);
    expect(await queued()).toEqual(capacity.waitlist.map((m) => m.person));
    await adminSql()`delete from public.booking_notifications`;

    const archived = await fullClass("nt2b");
    await adminSql()`update public.people set archived_at = now() where id = ${archived.first.person}`;
    expect(await queued()).toEqual([archived.waitlist[0]!.person]);
    await adminSql()`delete from public.booking_notifications`;

    const erased = await fullClass("nt2c");
    await asUser(erased.owner, (tx) => tx`select public.erase_person(${erased.first.person}, 'anonymize')`);
    expect(await queued()).toEqual([erased.waitlist[0]!.person]);
    await adminSql()`delete from public.booking_notifications`;

    const granted = await fullClass("nt2d", 2);
    await asUser(granted.owner, (tx) => tx`select public.promote_booking(${granted.session}, ${granted.waitlist[1]!.person})`);
    expect(await queued()).toEqual([granted.waitlist[1]!.person]);

    const { sent, mailer } = recorder();
    expect(await deliver(mailer)).toEqual({ sent: 1, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual([granted.waitlist[1]!.user.email]);
  });

  it("une transaction annulée ne laisse ni promotion ni notification", async () => {
    const { session, waitlist } = await fullClass("nt3");
    await adminSql()
      .begin(async (tx) => {
        await tx`update public.sessions set capacity = 2 where id = ${session}`;
        throw new Error("annulation volontaire");
      })
      .catch(() => undefined);
    expect(await status(session, waitlist[0]!.person)).toBe("waitlisted");
    expect(await queued()).toEqual([]);
  });

  it("fiche sans compte : promue, mais rien n'est mis en file", async () => {
    const { session, first, waitlist } = await fullClass("nt4");
    await adminSql()`delete from auth.users where id = ${waitlist[0]!.user.id}`; // compte supprimé : la fiche reste, sans compte
    await cancel(first.user, session);
    expect(await status(session, waitlist[0]!.person)).toBe("booked");
    expect(await queued()).toEqual([]);
  });
});

describe("envoi : rien pour une place qui n'est plus d'actualité", () => {
  it("réservation annulée, séance annulée ou commencée, adhérent retiré du club, archivé ou sans adresse confirmée : aucun e-mail, file vidée", async () => {
    const cancelled = await fullClass("nt5a");
    await cancel(cancelled.first.user, cancelled.session);
    await cancel(cancelled.waitlist[0]!.user, cancelled.session); // l'adhérent rend la place avant l'envoi
    expect(await queued()).toEqual([]);

    const sessionCancelled = await fullClass("nt5b");
    await cancel(sessionCancelled.first.user, sessionCancelled.session);
    await adminSql()`update public.sessions set status = 'cancelled' where id = ${sessionCancelled.session}`;
    // Annuler la séance prévient aussi ses inscrits (type 'cancelled', couvert par session-cancel-notifications.test.ts) : ici on ne juge que les places promues.
    await adminSql()`delete from public.booking_notifications where kind = 'cancelled'`;

    const started = await fullClass("nt5c", 1, inHours(0.5));
    await cancel(started.first.user, started.session);
    await adminSql()`update public.sessions set starts_at = now() - interval '5 minutes', ends_at = now() + interval '55 minutes' where id = ${started.session}`;

    const removed = await fullClass("nt5d");
    await cancel(removed.first.user, removed.session);
    await asUser(removed.owner, (tx) => tx`select public.remove_member(${removed.academy}, ${removed.waitlist[0]!.user.id})`);

    const unverified = await fullClass("nt5e");
    await cancel(unverified.first.user, unverified.session);
    await adminSql()`update auth.users set email_verified = false where id = ${unverified.waitlist[0]!.user.id}`;

    expect(await queued()).toHaveLength(4);
    const { sent, mailer } = recorder();
    expect(await deliver(mailer)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it("un changement d'horaire après la promotion : l'e-mail donne l'horaire en vigueur au moment de l'envoi", async () => {
    const { session, first, waitlist } = await fullClass("nt6");
    await cancel(first.user, session);
    const moved = new Date(Date.now() + 72 * 3_600_000);
    await adminSql()`update public.sessions set starts_at = ${moved}, ends_at = ${moved}::timestamptz + interval '1 hour' where id = ${session}`;
    const { sent, mailer } = recorder();
    await deliver(mailer);
    expect(sent.map((m) => m.to)).toEqual([waitlist[0]!.user.email]);
    expect(sent[0]!.text).toContain(`${formatDay(moved, "Europe/Paris")} à ${formatTime(moved, "Europe/Paris")}`);
  });
});

describe("fiabilité de l'envoi", () => {
  it("échec du fournisseur : la ligne reste, retentée après le bail de 10 minutes, abandonnée après 5 tentatives", async () => {
    const { session, first, waitlist } = await fullClass("nt7", 2);
    await cancel(first.user, session);
    const down = recorder(new Error("mail_delivery_failed status=503"));
    expect(await deliver(down.mailer)).toEqual({ sent: 0, failed: 1 });
    const [row] = await adminSql()<{ attempts: number; claimed: boolean }[]>`select attempts, claimed_at is not null as claimed from public.booking_notifications`;
    expect(row).toEqual({ attempts: 1, claimed: true });

    const up = recorder();
    expect(await deliver(up.mailer)).toEqual({ sent: 0, failed: 0 }); // bail en cours : pas de nouvel essai immédiat
    await adminSql()`update public.booking_notifications set claimed_at = now() - interval '11 minutes'`;
    expect(await deliver(up.mailer)).toEqual({ sent: 1, failed: 0 });
    expect(up.sent.map((m) => m.to)).toEqual([waitlist[0]!.user.email]);
    expect(await queued()).toEqual([]);

    // Le suivant : 5 échecs, puis abandon (aucun envoi tardif).
    await asUser(waitlist[0]!.user, (tx) => tx`select public.cancel_booking(${session})`);
    expect(await queued()).toEqual([waitlist[1]!.person]);
    for (let i = 0; i < 5; i++) {
      expect(await deliver(down.mailer)).toEqual({ sent: 0, failed: 1 });
      await adminSql()`update public.booking_notifications set claimed_at = now() - interval '11 minutes'`;
    }
    expect(await deliver(up.mailer)).toEqual({ sent: 0, failed: 0 });
    expect(await queued()).toEqual([]);
  });

  it("envois simultanés : chaque adhérent promu reçoit exactement un e-mail", async () => {
    const { session, waitlist } = await fullClass("nt8", 6);
    await setCapacity(session, null);
    expect(await queued()).toHaveLength(6);
    const recorders = [recorder(), recorder(), recorder()];
    const results = await Promise.all(recorders.map((r) => deliver(r.mailer)));
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(6);
    const recipients = recorders.flatMap((r) => r.sent.map((m) => m.to)).sort();
    expect(recipients).toEqual(waitlist.map((m) => m.user.email).sort());
  });

  it("deux clubs : chaque e-mail porte le club et le lien de sa séance", async () => {
    const a = await fullClass("nt9a");
    const b = await fullClass("nt9b");
    await cancel(a.first.user, a.session);
    await cancel(b.first.user, b.session);
    const { sent, mailer } = recorder();
    await deliver(mailer);
    const byTo = new Map(sent.map((m) => [m.to, m]));
    expect(byTo.get(a.waitlist[0]!.user.email)?.link).toBe(`${SITE}/a/${a.academy}/me`);
    expect(byTo.get(a.waitlist[0]!.user.email)?.text).toContain("Club nt9a");
    expect(byTo.get(b.waitlist[0]!.user.email)?.link).toBe(`${SITE}/a/${b.academy}/me`);
    expect(byTo.get(b.waitlist[0]!.user.email)?.text).not.toContain("Club nt9a");
  });
});

describe("file fermée", () => {
  it("ni membre, ni staff, ni app_server ne lisent la file ; les fonctions d'envoi sont réservées à app_server", async () => {
    const { owner, session, first, waitlist } = await fullClass("nt10");
    await cancel(first.user, session);
    for (const u of [owner, waitlist[0]!.user]) {
      expect((await failing(() => asUser(u, (tx) => tx`select * from public.booking_notifications`))).code).toBe("42501");
      expect((await failing(() => asUser(u, (tx) => tx`select * from app_private.claim_booking_notifications(10)`))).code).toBe("42501");
      expect((await failing(() => asUser(u, (tx) => tx`select app_private.complete_booking_notification(gen_random_uuid())`))).code).toBe("42501");
    }
    expect((await failing(() => appSql()`select * from public.booking_notifications`)).code).toBe("42501");
    expect((await failing(() => appSql()`insert into public.booking_notifications (academy_id, booking_id) values (gen_random_uuid(), gen_random_uuid())`)).code).toBe("42501");
    const [rls] = await adminSql()<{ enabled: boolean; forced: boolean; policies: number }[]>`
      select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'booking_notifications') as policies
      from pg_class c where c.oid = 'public.booking_notifications'::regclass`;
    expect(rls).toEqual({ enabled: true, forced: true, policies: 0 });
    expect(await queued()).toEqual([waitlist[0]!.person]); // rien n'a été consommé par ces tentatives
  });
});
