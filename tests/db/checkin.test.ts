import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, type ErrorCode } from "@/domain/errors";
import { withApp } from "@/server/db/client";
import {
  addMember, adminSql, appSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing,
  type TestUser, type World,
} from "./support";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

async function code(fn: () => Promise<unknown>): Promise<ErrorCode | "ok"> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
}

/** Séance en cours, affectée à `instructor`. */
const liveSession = (academy: string, instructor: string | null = null, offsetMin = -10) =>
  createSession(academy, { startsAt: new Date(Date.now() + offsetMin * 60_000).toISOString(), instructor });

const open = (user: { id: string }, session: string) => asUser(user, (tx) => tx`select public.checkin_open(${session}) as r`);
const close = (user: { id: string }, session: string) => asUser(user, (tx) => tx`select public.checkin_close(${session})`);
const issue = (user: { id: string }, session: string, token = newToken(), ttl = 90) =>
  asUser(user, (tx) => tx<{ e: Date }[]>`select public.checkin_issue_token(${session}, ${hash(token)}, ${ttl}) as e`).then((r) => ({ token, expires: r[0]!.e }));
/** Depuis 0013 la réservation est obligatoire pour pointer : ces tests (qui portent sur le pointage) réservent d'abord pour la fiche de l'appelant. */
async function reserve(user: { id: string }, token: string) {
  await adminSql()`
    insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at)
    select t.academy_id, t.session_id, p.id, 'booked', now()
    from public.checkin_tokens t join public.people p on p.academy_id = t.academy_id and p.user_id = ${user.id}
    where t.token_hash = ${hash(token)}
    on conflict (session_id, person_id) do nothing`;
}
const redeem = async (user: { id: string }, token: string) => (await reserve(user, token), redeemRaw(user, token));
const redeemRaw = (user: { id: string }, token: string) => asUser(user, (tx) => tx<{ r: { result: string; status: string } }[]>`select public.checkin_redeem(${hash(token)}) as r`).then((r) => r[0]!.r);
const peek = (user: { id: string }, token: string) => asUser(user, (tx) => tx<{ r: Record<string, unknown> }[]>`select public.checkin_peek(${hash(token)}) as r`).then((r) => r[0]!.r);

/** Adhérent connecté lié à une fiche dans l'académie. */
async function linkedMember(academy: string, label = "adh") {
  const user = await createUser(label);
  await addMember(academy, user, "member");
  const person = await createPerson(academy, label, "Lié");
  await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
  return { user, person };
}

const rows = (session: string) => adminSql()<{ person_id: string; status: string; source: string; recorded_by: string | null }[]>`select person_id, status, source, recorded_by from public.attendance where session_id = ${session}`;

describe("ouverture, fermeture et émission de jetons (côté coach)", () => {
  it("le coach affecté ouvre ; un autre coach, un membre et un autre club sont refusés", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    const other = await createUser("coach2");
    await addMember(w.academyA, other, "coach");
    expect(await code(() => open(w.carl, session))).toBe("ok");
    expect(await code(() => open(other, session))).toBe("forbidden"); // séance d'un autre coach
    expect(await code(() => open(w.mia, session))).toBe("forbidden"); // simple membre
    expect(await code(() => open(w.bob, session))).toBe("not_found"); // autre club : pas d'oracle d'existence
    expect(await code(() => open({ id: "00000000-0000-4000-8000-000000000000" }, session))).toBe("not_found");
    expect(await code(() => open(w.alice, session))).toBe("ok"); // le propriétaire peut toujours
  });

  it("refuse sans identité (auth.uid nul)", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    const e = await failing(() =>
      appSql().begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true)`;
        await tx`select public.checkin_open(${session})`;
      }),
    );
    expect(e.message).toContain("coachos:not_authenticated");
  });

  it("refuse une séance annulée, trop lointaine ou terminée depuis longtemps", async () => {
    const cancelled = await createSession(w.academyA, { startsAt: new Date().toISOString(), status: "cancelled" });
    expect(await code(() => open(w.alice, cancelled))).toBe("session_cancelled");
    const future = await liveSession(w.academyA, null, 60 * 5);
    expect(await code(() => open(w.alice, future))).toBe("checkin_too_early");
    const past = await liveSession(w.academyA, null, -60 * 6);
    expect(await code(() => open(w.alice, past))).toBe("checkin_too_late");
  });

  it("n'émet un jeton que lorsque le pointage est ouvert, avec une durée plafonnée, et ne stocke que le hachage", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    expect(await code(() => issue(w.carl, session))).toBe("checkin_closed");
    await open(w.carl, session);
    const { token, expires } = await issue(w.carl, session, newToken(), 100_000);
    expect(expires.getTime() - Date.now()).toBeLessThanOrEqual(300_000 + 2_000); // plafond 5 min
    const short = await issue(w.carl, session, newToken(), 1);
    expect(short.expires.getTime() - Date.now()).toBeGreaterThan(5_000); // plancher 10 s
    expect(await code(() => issue(w.mia, session))).toBe("forbidden");
    expect(await code(() => issue(w.bob, session))).toBe("not_found");

    const stored = await adminSql()`select * from public.checkin_tokens where session_id = ${session}`;
    expect(stored.length).toBe(2);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.map((r) => r.token_hash)).toContain(hash(token));
    const everything = JSON.stringify(await adminSql()`select * from public.audit_events where academy_id = ${w.academyA}`);
    expect(everything).not.toContain(token);
  });

  it("les jetons sont illisibles et inaltérables par un client ; l'état n'est lisible que par le staff du club", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    await issue(w.carl, session);
    for (const user of [w.carl, w.alice, w.mia, w.bob]) {
      const e = await failing(() => asUser(user, (tx) => tx`select * from public.checkin_tokens`));
      expect(e.code).toBe("42501");
    }
    expect((await failing(() => asUser(w.alice, (tx) => tx`insert into public.checkin_tokens (academy_id, session_id, token_hash, expires_at) values (${w.academyA}, ${session}, ${"a".repeat(64)}, now() + interval '1 day')`))).code).toBe("42501");
    expect((await asUser(w.carl, (tx) => tx`select status from public.session_checkins where session_id = ${session}`))).toHaveLength(1);
    expect((await asUser(w.mia, (tx) => tx`select * from public.session_checkins`))).toHaveLength(0);
    expect((await asUser(w.bob, (tx) => tx`select * from public.session_checkins where session_id = ${session}`))).toHaveLength(0);
    expect((await failing(() => asUser(w.alice, (tx) => tx`update public.session_checkins set status = 'open'`))).code).toBe("42501");
  });
});

describe("pointage par l'adhérent", () => {
  it("enregistre une présence 'qr' pour soi uniquement, après aperçu sans effet de bord", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    const m = await linkedMember(w.academyA, "ana");
    const other = await linkedMember(w.academyA, "bea");

    const preview = await peek(m.user, token);
    expect(preview).toMatchObject({ already_recorded: false });
    expect(await rows(session)).toHaveLength(0); // l'aperçu n'écrit rien

    expect(await redeem(m.user, token)).toMatchObject({ result: "recorded", status: "present" });
    const recorded = await rows(session);
    expect(recorded).toEqual([{ person_id: m.person, status: "present", source: "qr", recorded_by: m.user.id }]);
    expect(recorded.some((r) => r.person_id === other.person)).toBe(false); // personne d'autre n'est touché
    expect(await peek(m.user, token)).toMatchObject({ already_recorded: true, status: "present" });
  });

  it("double scan : une seule ligne, réponse honnête « déjà enregistré »", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    const m = await linkedMember(w.academyA, "dbl");
    expect((await redeem(m.user, token)).result).toBe("recorded");
    expect((await redeem(m.user, token)).result).toBe("already");
    expect((await redeem(m.user, (await issue(w.carl, session)).token)).result).toBe("already"); // autre jeton, même séance
    expect(await rows(session)).toHaveLength(1);
  });

  it("requêtes concurrentes : un seul pointage par membre, tous les membres distincts enregistrés", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    const same = await linkedMember(w.academyA, "conc");
    const results = await Promise.all(Array.from({ length: 12 }, () => redeem(same.user, token)));
    expect(results.filter((r) => r.result === "recorded")).toHaveLength(1);
    expect(results.filter((r) => r.result === "already")).toHaveLength(11);
    expect((await rows(session)).filter((r) => r.person_id === same.person)).toHaveLength(1);

    const many = await Promise.all(Array.from({ length: 10 }, (_, i) => linkedMember(w.academyA, `m${i}`)));
    const all = await Promise.all(many.flatMap((m) => [redeem(m.user, token), redeem(m.user, token)]));
    expect(all.filter((r) => r.result === "recorded")).toHaveLength(10);
    expect(await rows(session)).toHaveLength(11);
  });

  it("jeton inconnu, expiré, révoqué : même erreur générique", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const m = await linkedMember(w.academyA, "tok");
    expect(await code(() => redeem(m.user, newToken()))).toBe("checkin_invalid");

    const expired = await issue(w.carl, session);
    await adminSql()`update public.checkin_tokens set expires_at = now() - interval '1 second' where token_hash = ${hash(expired.token)}`;
    expect(await code(() => redeem(m.user, expired.token))).toBe("checkin_invalid");
    expect(await code(() => peek(m.user, expired.token))).toBe("checkin_invalid");

    const revoked = await issue(w.carl, session);
    await adminSql()`update public.checkin_tokens set revoked_at = now() where token_hash = ${hash(revoked.token)}`;
    expect(await code(() => redeem(m.user, revoked.token))).toBe("checkin_invalid");
    expect(await rows(session)).toHaveLength(0);

    const fresh = await issue(w.carl, session);
    expect(await code(() => redeem(m.user, fresh.token))).toBe("ok");
  });

  it("refuse si le pointage est fermé, la séance annulée, la fenêtre échue ou la feuille validée", async () => {
    const m = await linkedMember(w.academyA, "etat");
    const make = async () => {
      const session = await liveSession(w.academyA, w.carl.id);
      await open(w.carl, session);
      return { session, ...(await issue(w.carl, session)) };
    };

    const a = await make();
    await close(w.carl, a.session);
    expect(await code(() => redeem(m.user, a.token))).toBe("checkin_invalid"); // fermeture = révocation immédiate
    expect(await code(() => issue(w.carl, a.session))).toBe("checkin_closed");

    const b = await make();
    await adminSql()`update public.sessions set status = 'cancelled' where id = ${b.session}`;
    expect(await code(() => redeem(m.user, b.token))).toBe("checkin_invalid");

    const c = await make();
    await adminSql()`update public.session_checkins set window_ends_at = now() - interval '1 minute' where session_id = ${c.session}`;
    expect(await code(() => redeem(m.user, c.token))).toBe("checkin_invalid");
    expect(await code(() => issue(w.carl, c.session))).toBe("checkin_closed");

    const d = await make();
    await asUser(w.carl, (tx) => tx`select public.roll_set_validated(${d.session}, true)`);
    expect(await code(() => redeem(m.user, d.token))).toBe("checkin_invalid");
    expect(await code(() => open(w.carl, d.session))).toBe("roll_validated");

    for (const s of [a, b, c, d]) expect(await rows(s.session)).toHaveLength(0);
  });

  it("utilisateur non connecté, hors club, sans fiche liée ou archivé : jamais de pointage", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);

    const e = await failing(() =>
      appSql().begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true)`;
        await tx`select public.checkin_redeem(${hash(token)})`;
      }),
    );
    expect(e.message).toContain("coachos:not_authenticated");

    const outsider = await linkedMember(w.academyB, "autre-club"); // membre d'un autre club, fiche liée chez lui
    expect(await code(() => redeem(outsider.user, token))).toBe("checkin_invalid");
    expect(await code(() => redeem(w.bob, token))).toBe("checkin_invalid"); // propriétaire d'un autre club
    const stranger = await createUser("sans-club");
    expect(await code(() => redeem(stranger, token))).toBe("checkin_invalid");

    // erreur strictement identique pour jeton valide/autre club et jeton inexistant : aucune fuite
    const unknown = await asUser(outsider.user, (tx) => tx`select public.checkin_redeem(${hash(newToken())})`).catch((x: AppError) => x);
    const foreign = await asUser(outsider.user, (tx) => tx`select public.checkin_redeem(${hash(token)})`).catch((x: AppError) => x);
    expect((unknown as AppError).message).toBe((foreign as AppError).message);

    const noProfile = await createUser("sans-fiche");
    await addMember(w.academyA, noProfile, "member");
    expect(await code(() => redeem(noProfile, token))).toBe("checkin_no_profile");
    expect(await code(() => redeem(w.carl, token))).toBe("checkin_no_profile"); // un coach sans fiche membre

    const archived = await linkedMember(w.academyA, "archive");
    await adminSql()`update public.people set archived_at = now() where id = ${archived.person}`;
    expect(await code(() => redeem(archived.user, token))).toBe("checkin_no_profile");
    expect(await rows(session)).toHaveLength(0);
  });

  it("ne peut jamais pointer pour un autre membre : l'identité vient de la session, pas du QR ni d'un paramètre", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    const victim = await linkedMember(w.academyA, "victime");
    const attacker = await linkedMember(w.academyA, "attaquant");
    await redeem(attacker.user, token);
    const r = await rows(session);
    expect(r.map((x) => x.person_id)).toEqual([attacker.person]);
    expect(r.some((x) => x.person_id === victim.person)).toBe(false);
    // un membre ne peut pas écrire la table directement, ni forger source='qr'
    const direct = await failing(() => asUser(attacker.user, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${session}, ${victim.person}, 'present')`));
    expect(direct.code).toBe("42501");
    const forged = await failing(() => asUser(w.carl, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status, source) values (${w.academyA}, ${session}, ${victim.person}, 'present', 'qr')`));
    expect(forged.code).toBe("42501");
  });
});

describe("feuille d'appel : corrections du coach et validation", () => {
  it("une correction du coach redevient manuelle et n'est jamais écrasée par un nouveau scan ; ajout manuel possible", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    const m = await linkedMember(w.academyA, "corr");
    await redeem(m.user, token);

    await asUser(w.carl, (tx) => tx`update public.attendance set status = 'absent' where session_id = ${session} and person_id = ${m.person}`);
    expect((await rows(session))[0]).toMatchObject({ status: "absent", source: "manual" });
    expect(await redeem(m.user, token)).toMatchObject({ result: "already", status: "absent" }); // la décision du coach prévaut
    expect((await rows(session))[0]).toMatchObject({ status: "absent", source: "manual" });

    const walkIn = await createPerson(w.academyA, "Manuel", "Ajouté");
    await asUser(w.carl, (tx) => tx`insert into public.attendance (academy_id, session_id, person_id, status) values (${w.academyA}, ${session}, ${walkIn}, 'late')`);
    expect((await rows(session)).find((r) => r.person_id === walkIn)).toMatchObject({ status: "late", source: "manual", recorded_by: w.carl.id });

    await asUser(w.carl, (tx) => tx`delete from public.attendance where session_id = ${session} and person_id = ${m.person}`);
    expect(await redeem(m.user, token)).toMatchObject({ result: "recorded" }); // retiré par erreur : le membre peut re-pointer
  });

  it("validation : réservée aux personnes habilitées, ferme le pointage, réversible, journalisée sans jeton", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    expect(await code(() => asUser(w.mia, (tx) => tx`select public.roll_set_validated(${session}, true)`))).toBe("forbidden");
    expect(await code(() => asUser(w.bob, (tx) => tx`select public.roll_set_validated(${session}, true)`))).toBe("not_found");

    await asUser(w.carl, (tx) => tx`select public.roll_set_validated(${session}, true)`);
    const [state] = await adminSql()`select status, validated_by from public.session_checkins where session_id = ${session}`;
    expect(state).toMatchObject({ status: "closed", validated_by: w.carl.id });
    expect((await adminSql()`select 1 from public.checkin_tokens where session_id = ${session} and revoked_at is null`)).toHaveLength(0);

    // déverrouillage puis réouverture
    await asUser(w.carl, (tx) => tx`select public.roll_set_validated(${session}, false)`);
    expect(await code(() => open(w.carl, session))).toBe("ok");
    expect(await code(() => issue(w.carl, session))).toBe("ok");

    const actions = (await adminSql()<{ action: string }[]>`select action from public.audit_events where entity_id = ${session} order by id`).map((r) => r.action);
    expect(actions).toEqual(["checkin.opened", "roll.validated", "roll.reopened", "checkin.opened"]);
    expect(JSON.stringify(await adminSql()`select * from public.audit_events where entity_id = ${session}`)).not.toContain(token);

    const cancelled = await createSession(w.academyA, { startsAt: new Date().toISOString(), status: "cancelled" });
    expect(await code(() => asUser(w.alice, (tx) => tx`select public.roll_set_validated(${cancelled}, true)`))).toBe("session_cancelled");
  });
});

describe("isolation entre clubs et rétention", () => {
  it("le club B ne peut ni piloter ni lire le pointage du club A, ni utiliser ses jetons", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const { token } = await issue(w.carl, session);
    const memberB = await linkedMember(w.academyB, "mb");
    for (const fn of [
      () => open(w.bob, session),
      () => close(w.bob, session),
      () => issue(w.bob, session),
      () => asUser(w.bob, (tx) => tx`select public.roll_set_validated(${session}, true)`),
    ]) expect(await code(fn)).toBe("not_found");
    expect(await code(() => redeem(memberB.user, token))).toBe("checkin_invalid");
    expect(await code(() => peek(memberB.user, token))).toBe("checkin_invalid");
    expect(await asUser(w.bob, (tx) => tx`select * from public.session_checkins`)).toHaveLength(0);
    expect((await rows(session))).toHaveLength(0);
  });

  it("la purge supprime les jetons périmés depuis plus d'un jour et épargne les récents", async () => {
    const session = await liveSession(w.academyA, w.carl.id);
    await open(w.carl, session);
    const old = await issue(w.carl, session);
    const recent = await issue(w.carl, session);
    await adminSql()`update public.checkin_tokens set expires_at = now() - interval '2 days' where token_hash = ${hash(old.token)}`;
    const [{ r }] = await withApp((tx) => tx<[{ r: Record<string, number> }]>`select app_private.purge_expired_data() as r`, appSql());
    expect(r.checkin_tokens_deleted).toBeGreaterThanOrEqual(1);
    expect(await adminSql()`select 1 from public.checkin_tokens where token_hash = ${hash(old.token)}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.checkin_tokens where token_hash = ${hash(recent.token)}`).toHaveLength(1);
  });

  it("la suppression d'une séance ou d'un club emporte états et jetons", async () => {
    const owner: TestUser = await createUser("ephemere");
    const academy = await createAcademy(owner, "Club éphémère");
    const session = await liveSession(academy);
    await open(owner, session);
    await issue(owner, session);
    await asUser(owner, (tx) => tx`select public.delete_academy(${academy}, 'Club éphémère')`);
    expect(await adminSql()`select 1 from public.checkin_tokens where session_id = ${session}`).toHaveLength(0);
    expect(await adminSql()`select 1 from public.session_checkins where session_id = ${session}`).toHaveLength(0);
  });
});
