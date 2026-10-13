import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth, DISABLED_PATHS, type CoachAuth, type Limiter } from "@/server/auth/factory";
import type { MailMessage, Mailer } from "@/server/mail/types";
import { forgeToken } from "../support/forge";
import { adminSql, appSql, asUser, closeAll, createAcademy, failing } from "./support";

/**
 * Better Auth contre le vrai PostgreSQL de test (rôle `auth_runtime`, migrations réelles, RLS réelle).
 * Aucun réseau : l'envoi d'e-mails est capturé en mémoire.
 */
const APP_SECRET = randomBytes(32).toString("hex");
const PASSWORD = `Test-${randomBytes(9).toString("hex")}`; // mot de passe jetable de test
const BASE = "http://127.0.0.1:3999";

const sent: MailMessage[] = [];
const mailer: Mailer = { async send(m) { sent.push(m); } };
const mac = (raw: string) => createHmac("sha256", APP_SECRET).update(raw).digest("hex").slice(0, 32);
const limiter: Limiter = {
  pseudonym: mac,
  async hit(scope, raw, max, windowSeconds) {
    const key = `${scope}:${mac(raw)}`;
    const [row] = await appSql()<{ ok: boolean }[]>`select app_private.hit_rate_limit(${key}, ${max}, ${windowSeconds}) as ok`;
    return row!.ok;
  },
};

let pool: pg.Pool;
let auth: CoachAuth;
let shortAuth: CoachAuth; // durées de vie de 1 s : prouve l'expiration

let ipCounter = 0;
const ip = () => `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.9`;
const hdr = (address = ip()) => new Headers({ "x-real-ip": address, origin: BASE });
const mailAddress = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.invalid`;
const lastMail = (to: string, kind: MailMessage["kind"]) => sent.filter((m) => m.to === to && m.kind === kind).at(-1);

function make(overrides: Partial<Parameters<typeof createAuth>[0]> = {}): CoachAuth {
  return createAuth({ pool, mailer, limiter, secret: randomBytes(32).toString("hex"), baseURL: BASE, ...overrides });
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: process.env.TEST_AUTH_DATABASE_URL!, options: "-c search_path=auth", max: 4 });
  const secret = randomBytes(32).toString("hex");
  auth = make({ secret });
  shortAuth = make({ secret, verifyTtl: 1, resetTtl: 1 });
});
afterAll(async () => {
  await pool.end();
  await closeAll();
});

async function register(label: string, verify = true) {
  const email = mailAddress(label);
  const res = await auth.api.signUpEmail({ body: { name: label, email, password: PASSWORD }, headers: hdr() });
  if (verify) await verifyLink(email);
  return { email, id: res.user.id };
}
async function verifyLink(email: string, a: CoachAuth = auth) {
  const token = new URL(lastMail(email, "verification")!.link).searchParams.get("token")!;
  await a.api.verifyEmail({ query: { token } });
}
async function signInCookie(email: string, password = PASSWORD, address = ip()) {
  const res = await auth.api.signInEmail({ body: { email, password }, headers: hdr(address), asResponse: true });
  const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token"))!.split(";")[0]!;
  return { cookie, status: res.status };
}
const sessionOf = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) });
const statusOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 0;
  }
};

describe("Better Auth : parcours complet", () => {
  it("inscription → e-mail de vérification → refus avant vérification → vérification → connexion → session → déconnexion", async () => {
    const email = mailAddress("flow");
    await auth.api.signUpEmail({ body: { name: "Flow Test", email, password: PASSWORD }, headers: hdr() });
    expect(lastMail(email, "verification")?.link).toContain("/api/auth/verify-email?token=");
    expect(await statusOf(() => auth.api.signInEmail({ body: { email, password: PASSWORD }, headers: hdr() }))).toBe(403);
    await verifyLink(email);
    const { cookie } = await signInCookie(email);
    const session = await sessionOf(cookie);
    expect(session?.user.email).toBe(email);
    expect(session?.user.emailVerified).toBe(true);
    await auth.api.signOut({ headers: new Headers({ cookie }) });
    expect(await sessionOf(cookie)).toBeNull();
    expect(await adminSql()`select 1 from auth.sessions where user_id = ${session!.user.id}`).toHaveLength(0);
  });

  it("le déclencheur crée le profil (nom affiché) ; l'adresse est normalisée en minuscules", async () => {
    const email = mailAddress("Maj").toUpperCase().replace("@EXAMPLE.INVALID", "@Example.Invalid");
    const res = await auth.api.signUpEmail({ body: { name: "Nom Affiché", email, password: PASSWORD }, headers: hdr() });
    const [profile] = await adminSql()<{ display_name: string; email: string }[]>`select display_name, email from public.profiles where id = ${res.user.id}`;
    expect(profile).toEqual({ display_name: "Nom Affiché", email: email.toLowerCase() });
  });

  it("une inscription avec un nom vide est acceptée (nom affiché facultatif)", async () => {
    const res = await auth.api.signUpEmail({ body: { name: "", email: mailAddress("sansnom"), password: PASSWORD }, headers: hdr() });
    const [profile] = await adminSql()<{ display_name: string }[]>`select display_name from public.profiles where id = ${res.user.id}`;
    expect(profile?.display_name).toBe("");
  });

  it("adresse déjà utilisée : même réponse, aucun doublon, aucun second e-mail", async () => {
    const { email } = await register("dup");
    const before = sent.length;
    const again = await statusOf(() => auth.api.signUpEmail({ body: { name: "Dup", email, password: PASSWORD }, headers: hdr() }));
    expect(again).toBe(200);
    expect(await adminSql()`select 1 from auth.users where email = ${email}`).toHaveLength(1);
    expect(sent.length).toBe(before);
  });

  it("mot de passe trop court refusé ; mot de passe haché en base ; jeton de session signé par cookie", async () => {
    expect(await statusOf(() => auth.api.signUpEmail({ body: { name: "X", email: mailAddress("court"), password: "court" }, headers: hdr() }))).toBeGreaterThanOrEqual(400);
    const { email, id } = await register("hash");
    const [acc] = await adminSql()<{ password: string }[]>`select password from auth.accounts where user_id = ${id}`;
    expect(acc!.password).not.toContain(PASSWORD);
    const { cookie } = await signInCookie(email);
    const [row] = await adminSql()<{ token: string }[]>`select token from auth.sessions where user_id = ${id}`;
    // Le jeton brut (lu en base) ne suffit pas : il faut la signature HMAC du cookie.
    expect(await sessionOf(`better-auth.session_token=${row!.token}`)).toBeNull();
    expect(await sessionOf(`better-auth.session_token=${row!.token}.${"A".repeat(44)}`)).toBeNull();
    expect(await sessionOf(cookie)).not.toBeNull();
  });
});

describe("Better Auth : récupération du mot de passe et sessions", () => {
  it("réponse identique connu/inconnu ; jeton à usage unique ; ancien mot de passe refusé ; TOUTES les sessions révoquées", async () => {
    const { email, id } = await register("reset");
    const a = await signInCookie(email);
    const b = await signInCookie(email);
    expect(await adminSql()`select 1 from auth.sessions where user_id = ${id}`).toHaveLength(2);

    const unknown = mailAddress("personne");
    const before = sent.length;
    const r1 = await auth.api.requestPasswordReset({ body: { email: unknown, redirectTo: `${BASE}/reset-password` }, headers: hdr() });
    expect(sent.length).toBe(before);
    const r2 = await auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE}/reset-password` }, headers: hdr() });
    expect(r1).toEqual(r2);
    await vi.waitFor(() => expect(lastMail(email, "password_reset")).toBeTruthy());
    const token = new URL(lastMail(email, "password_reset")!.link).pathname.split("/").at(-1)!;

    const NEW = `Neuf-${randomBytes(9).toString("hex")}`;
    await auth.api.resetPassword({ body: { newPassword: NEW, token } });
    expect(await adminSql()`select 1 from auth.sessions where user_id = ${id}`).toHaveLength(0);
    expect(await sessionOf(a.cookie)).toBeNull();
    expect(await sessionOf(b.cookie)).toBeNull();
    expect(await statusOf(() => auth.api.signInEmail({ body: { email, password: PASSWORD }, headers: hdr() }))).toBe(401);
    expect((await signInCookie(email, NEW)).status).toBe(200);
    expect(await statusOf(() => auth.api.resetPassword({ body: { newPassword: `Autre-${randomBytes(9).toString("hex")}`, token } }))).toBeGreaterThanOrEqual(400);
  });

  it("jeton de réinitialisation falsifié ou expiré refusé ; le mot de passe reste inchangé", async () => {
    const { email } = await register("resetbad");
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE}/reset-password` }, headers: hdr() });
    await vi.waitFor(() => expect(lastMail(email, "password_reset")).toBeTruthy());
    const token = new URL(lastMail(email, "password_reset")!.link).pathname.split("/").at(-1)!;
    const forged = forgeToken(token);
    expect(forged).not.toBe(token);
    expect(await statusOf(() => auth.api.resetPassword({ body: { newPassword: `Faux-${randomBytes(9).toString("hex")}`, token: forged } }))).toBeGreaterThanOrEqual(400);

    const { email: e2 } = await register("resetexp");
    await shortAuth.api.requestPasswordReset({ body: { email: e2, redirectTo: `${BASE}/reset-password` }, headers: hdr() });
    await vi.waitFor(() => expect(lastMail(e2, "password_reset")).toBeTruthy());
    const t2 = new URL(lastMail(e2, "password_reset")!.link).pathname.split("/").at(-1)!;
    await new Promise((r) => setTimeout(r, 2200));
    expect(await statusOf(() => shortAuth.api.resetPassword({ body: { newPassword: `Perime-${randomBytes(9).toString("hex")}`, token: t2 } }))).toBeGreaterThanOrEqual(400);
    expect((await signInCookie(email)).status).toBe(200);
    expect((await signInCookie(e2)).status).toBe(200);
  });

  it("lien de vérification falsifié ou expiré : compte non vérifié ; rejeu : sans effet ni session", async () => {
    const email = mailAddress("verif");
    await auth.api.signUpEmail({ body: { name: "V", email, password: PASSWORD }, headers: hdr() });
    const token = new URL(lastMail(email, "verification")!.link).searchParams.get("token")!;
    expect(await statusOf(() => auth.api.verifyEmail({ query: { token: forgeToken(token) } }))).toBeGreaterThanOrEqual(400);
    expect(await statusOf(() => auth.api.verifyEmail({ query: { token: "n-importe-quoi" } }))).toBeGreaterThanOrEqual(400);
    const [u0] = await adminSql()<{ email_verified: boolean }[]>`select email_verified from auth.users where email = ${email}`;
    expect(u0!.email_verified).toBe(false);

    const exp = mailAddress("verifexp");
    await shortAuth.api.signUpEmail({ body: { name: "V", email: exp, password: PASSWORD }, headers: hdr() });
    const t2 = new URL(lastMail(exp, "verification")!.link).searchParams.get("token")!;
    await new Promise((r) => setTimeout(r, 2200));
    expect(await statusOf(() => shortAuth.api.verifyEmail({ query: { token: t2 } }))).toBeGreaterThanOrEqual(400);

    await auth.api.verifyEmail({ query: { token } });
    await auth.api.verifyEmail({ query: { token } }); // rejeu
    const [u1] = await adminSql()<{ id: string; email_verified: boolean }[]>`select id, email_verified from auth.users where email = ${email}`;
    expect(u1!.email_verified).toBe(true);
    expect(await adminSql()`select 1 from auth.sessions where user_id = ${u1!.id}`).toHaveLength(0); // jamais de connexion automatique
  });

  it("changement de mot de passe : mot de passe actuel exigé, autres sessions révoquées", async () => {
    const { email } = await register("chg");
    const a = await signInCookie(email);
    const b = await signInCookie(email);
    const NEW = `Chg-${randomBytes(9).toString("hex")}`;
    expect(await statusOf(() => auth.api.changePassword({ body: { currentPassword: "mauvais-mot-de-passe", newPassword: NEW, revokeOtherSessions: true }, headers: new Headers({ cookie: a.cookie }) }))).toBeGreaterThanOrEqual(400);
    const res = await auth.api.changePassword({ body: { currentPassword: PASSWORD, newPassword: NEW, revokeOtherSessions: true }, headers: new Headers({ cookie: a.cookie }), asResponse: true });
    expect(res.status).toBe(200);
    // Better Auth émet une NOUVELLE session pour l'appareil courant (cookie de la réponse) et révoque toutes les autres, y compris l'ancienne.
    const fresh = res.headers.getSetCookie().find((c) => c.includes("session_token"))!.split(";")[0]!;
    expect(await sessionOf(b.cookie)).toBeNull();
    expect(await sessionOf(a.cookie)).toBeNull();
    expect(await sessionOf(fresh)).not.toBeNull();
  });
});

describe("Better Auth : confidentialité et limitation de débit", () => {
  it("IP de session pseudonymisée ; identifiants de jetons hachés ; aucune IP ni e-mail en clair dans les compteurs", async () => {
    const { email, id } = await register("priv");
    const address = "198.51.100.77";
    await signInCookie(email, PASSWORD, address);
    const [s] = await adminSql()<{ ip_address: string }[]>`select ip_address from auth.sessions where user_id = ${id}`;
    expect(s!.ip_address).toBe(mac(address));
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE}/reset-password` }, headers: hdr(address) });
    await vi.waitFor(() => expect(lastMail(email, "password_reset")).toBeTruthy());
    const token = new URL(lastMail(email, "password_reset")!.link).pathname.split("/").at(-1)!;
    const ids = await adminSql()<{ identifier: string }[]>`select identifier from auth.verifications`;
    expect(ids.some((r) => r.identifier.includes(token))).toBe(false);
    const keys = await adminSql()<{ key: string }[]>`select key from app_private.rate_limits`;
    expect(keys.length).toBeGreaterThan(0);
    for (const { key } of keys) {
      expect(key).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(key).not.toContain("@");
    }
  });

  it("connexion : 10 essais par e-mail même avec une IP tournante, puis 429 ; l'existence du compte n'y change rien", async () => {
    const { email } = await register("lim");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push(await statusOf(() => auth.api.signInEmail({ body: { email, password: "mauvais-mot-de-passe-1" }, headers: hdr() })));
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
    const ghost: number[] = [];
    for (let i = 0; i < 12; i++) ghost.push(await statusOf(() => auth.api.signInEmail({ body: { email: mailAddress("fantome"), password: "x" + i }, headers: hdr() })));
    expect(ghost.every((s) => s === 401)).toBe(true); // adresses distinctes : pas de limite croisée
  });

  it("25 tentatives parallèles : exactement 10 passent (compteur atomique)", async () => {
    const email = mailAddress("par");
    const res = await Promise.all(Array.from({ length: 25 }, () => statusOf(() => auth.api.signInEmail({ body: { email, password: "mauvais-mot-de-passe-1" }, headers: hdr() }))));
    expect(res.filter((s) => s === 401)).toHaveLength(10);
    expect(res.filter((s) => s === 429)).toHaveLength(15);
  });

  it("inscription : 6e demande depuis la même IP refusée ; réinitialisation : 4e demande pour une même adresse refusée", async () => {
    const fixed = ip();
    const s: number[] = [];
    for (let i = 0; i < 7; i++) s.push(await statusOf(() => auth.api.signUpEmail({ body: { name: "R", email: mailAddress("flood"), password: PASSWORD }, headers: hdr(fixed) })));
    expect(s.slice(0, 5).every((x) => x === 200)).toBe(true);
    expect(s.slice(5).every((x) => x === 429)).toBe(true);
    const target = mailAddress("resetflood");
    const r: number[] = [];
    for (let i = 0; i < 5; i++) r.push(await statusOf(() => auth.api.requestPasswordReset({ body: { email: target, redirectTo: `${BASE}/reset-password` }, headers: hdr() })));
    expect(r).toEqual([200, 200, 200, 429, 429]);
  });

  it("surface HTTP : les endpoints redondants avec les Server Actions sont refusés (404), sans effet de bord ni contournement par variante de chemin", async () => {
    // Liste VOLONTAIREMENT recopiée ici : retirer une entrée de DISABLED_PATHS doit faire échouer ce test.
    const MUST_BE_DISABLED = [
      "/sign-up/email", "/sign-in/email", "/sign-out", "/request-password-reset", "/reset-password", "/change-password",
      "/update-user", "/send-verification-email", "/list-sessions", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions",
      "/sign-in/social", "/change-email", "/delete-user", "/get-session",
    ];
    for (const p of MUST_BE_DISABLED) expect(DISABLED_PATHS, p).toContain(p);

    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      auth.handler(new Request(`${BASE}/api/auth${path}`, { method, headers: { "content-type": "application/json", origin: BASE, "x-real-ip": ip(), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }));

    // 1. Chaque chemin est refusé, quelle que soit la méthode.
    for (const p of MUST_BE_DISABLED) {
      expect((await call("POST", p, {})).status, `POST ${p}`).toBe(404);
      expect((await call("GET", p)).status, `GET ${p}`).toBe(404);
    }

    // 2. Aucun effet de bord, avec des requêtes qui seraient valides si le chemin était ouvert.
    const sessionsBefore = (await adminSql()<{ n: number }[]>`select count(*)::int as n from auth.sessions`)[0]!.n;
    const fresh = mailAddress("http-signup");
    const signup = await call("POST", "/sign-up/email", { name: "N".repeat(20_000), email: fresh, password: PASSWORD });
    expect(signup.status).toBe(404);
    expect(await adminSql()`select 1 from auth.users where email = ${fresh}`).toHaveLength(0);
    const known = await register("http-known");
    const login = await call("POST", "/sign-in/email", { email: known.email, password: PASSWORD });
    expect(login.status).toBe(404);
    expect(login.headers.get("set-cookie")).toBeNull();
    const reset = await call("POST", "/request-password-reset", { email: known.email, redirectTo: `${BASE}/reset-password` });
    expect(reset.status).toBe(404);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.filter((m) => m.to === known.email && m.kind === "password_reset")).toHaveLength(0);
    // Une session légitime (créée côté serveur) ne peut pas non plus modifier son profil ni changer de mot de passe par HTTP.
    const { cookie } = await signInCookie(known.email);
    const sessionsDuring = (await adminSql()<{ n: number }[]>`select count(*)::int as n from auth.sessions`)[0]!.n;
    expect(sessionsDuring).toBe(sessionsBefore + 1);
    expect((await call("POST", "/update-user", { name: "Pirate".repeat(5000) }, { cookie })).status).toBe(404);
    expect((await call("POST", "/change-password", { currentPassword: PASSWORD, newPassword: `Pirate-${randomBytes(9).toString("hex")}`, revokeOtherSessions: true }, { cookie })).status).toBe(404);
    expect((await call("POST", "/sign-out", {}, { cookie })).status).toBe(404);
    expect(await sessionOf(cookie)).not.toBeNull(); // la session existe toujours : rien n'a été traité
    const [u] = await adminSql()<{ name: string }[]>`select name from auth.users where id = ${known.id}`;
    expect(u!.name).toBe("http-known");
    expect(sent.filter((m) => m.to === fresh)).toHaveLength(0); // aucun e-mail pour le compte refusé

    // 3. Variantes de chemin : aucune ne contourne le refus (pas de cookie de session, pas de nouvelle session).
    const variants = [
      "/SIGN-IN/email", "/sign-in/EMAIL", "/sign-in/email/", "//sign-in/email", "/./sign-in/email", "/sign-in/./email",
      "/sign-in%2Femail", "/sign-in/email%20", "/sign-in/email?x=1", "/sign-in/email#x", "/%73ign-in/email", "/sign-in/%65mail",
    ];
    const before = (await adminSql()<{ n: number }[]>`select count(*)::int as n from auth.sessions`)[0]!.n;
    for (const v of variants) {
      const res = await call("POST", v, { email: known.email, password: PASSWORD });
      expect(res.headers.get("set-cookie"), v).toBeNull();
      expect(res.status, v).toBeGreaterThanOrEqual(400);
      expect(res.status, v).not.toBe(401); // 401 = « mauvais mot de passe » : l'endpoint aurait traité la requête
      expect(res.status, v).not.toBe(429);
    }
    expect((await adminSql()<{ n: number }[]>`select count(*)::int as n from auth.sessions`)[0]!.n).toBe(before);

    // 4. Les routes sociales dynamiques n'existent pas (aucun fournisseur) : jamais de succès ni de redirection.
    for (const p of ["/callback/google", "/callback/github", "/oauth2/callback/x"]) {
      const res = await call("GET", p);
      expect(res.status, p).not.toBe(200);
      if (res.status >= 300 && res.status < 400) expect(res.headers.get("location") ?? "", p).toMatch(/error/); // seule redirection admise : vers la page d'erreur de l'authentification
    }
  });

  it("surface HTTP restante : liens d'e-mail et sonde fonctionnent ; redirections externes refusées ; limite par IP", async () => {
    // Sonde de vie
    expect((await auth.handler(new Request(`${BASE}/api/auth/ok`, { headers: { "x-real-ip": ip() } }))).status).toBe(200);

    // Lien de confirmation : vérifie l'adresse puis redirige vers le chemin relatif demandé, sans ouvrir de session.
    const email = mailAddress("http-verify");
    await auth.api.signUpEmail({ body: { name: "V", email, password: PASSWORD, callbackURL: "/login?verified=1" }, headers: hdr() });
    const link = lastMail(email, "verification")!.link;
    const ok = await auth.handler(new Request(link, { headers: { "x-real-ip": ip() } }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/login?verified=1");
    expect(ok.headers.get("set-cookie")).toBeNull();
    const [v] = await adminSql()<{ email_verified: boolean }[]>`select email_verified from auth.users where email = ${email}`;
    expect(v!.email_verified).toBe(true);

    // Jeton falsifié : redirection avec erreur, compte non vérifié.
    const email2 = mailAddress("http-verify2");
    await auth.api.signUpEmail({ body: { name: "V", email: email2, password: PASSWORD, callbackURL: "/login?verified=1" }, headers: hdr() });
    const bad = new URL(lastMail(email2, "verification")!.link);
    bad.searchParams.set("token", forgeToken(bad.searchParams.get("token")!));
    const refused = await auth.handler(new Request(bad, { headers: { "x-real-ip": ip() } }));
    expect(refused.headers.get("location") ?? "").toMatch(/error=/);
    expect((await adminSql()<{ email_verified: boolean }[]>`select email_verified from auth.users where email = ${email2}`)[0]!.email_verified).toBe(false);

    // Lien de réinitialisation légitime : redirige vers la page de l'application avec le jeton.
    const { email: resetEmail } = await register("http-resetuser");
    await auth.api.requestPasswordReset({ body: { email: resetEmail, redirectTo: `${BASE}/reset-password` }, headers: hdr() });
    await vi.waitFor(() => expect(lastMail(resetEmail, "password_reset")).toBeTruthy());
    const good = await auth.handler(new Request(lastMail(resetEmail, "password_reset")!.link, { headers: { "x-real-ip": ip() } }));
    expect(good.status).toBe(302);
    expect(good.headers.get("location")).toMatch(/^http:\/\/127\.0\.0\.1:3999\/reset-password\?token=/);
    // (Le refus des redirections externes est prouvé en e2e, serveur de production : Better Auth ne l'applique pas sous NODE_ENV=test.)

    // Limite par IP sur le seul endpoint de vérification encore ouvert : 30 / 15 min, puis 429.
    const fixed = ip();
    const codes: number[] = [];
    for (let i = 0; i < 33; i++) codes.push((await auth.handler(new Request(`${BASE}/api/auth/verify-email?token=inconnu${i}&callbackURL=%2Flogin`, { headers: { "x-real-ip": fixed } }))).status);
    expect(codes.slice(0, 30).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(30).every((c) => c === 429)).toBe(true);
  });
});

describe("Better Auth : journaux, erreurs et schéma", () => {
  it("une erreur SQL ne fuit ni le texte SQL, ni l'adresse, ni le mot de passe dans les journaux ni dans l'erreur", async () => {
    const out: string[] = [];
    const spies = (["log", "warn", "error", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))));
    await adminSql().unsafe(`create function app_private.poc_boom() returns trigger language plpgsql as $$
      begin raise exception 'MARQUEUR_FUITE insert into table_secrete values (%)', new.email; end $$;
      create trigger poc_boom before insert on auth.users for each row execute function app_private.poc_boom()`);
    const email = mailAddress("boom");
    let message = "";
    try {
      await auth.api.signUpEmail({ body: { name: "Boom", email, password: PASSWORD }, headers: hdr() });
    } catch (e) {
      message = JSON.stringify(e instanceof Error ? { m: e.message, b: (e as { body?: unknown }).body } : e);
    } finally {
      await adminSql().unsafe("drop trigger poc_boom on auth.users; drop function app_private.poc_boom()");
      spies.forEach((s) => s.mockRestore());
    }
    expect(message).not.toBe("");
    const all = out.join("\n") + message;
    for (const forbidden of ["MARQUEUR_FUITE", "table_secrete", "insert into", email, PASSWORD]) expect(all.includes(forbidden), forbidden).toBe(false);
    expect(await adminSql()`select 1 from auth.users where email = ${email}`).toHaveLength(0);
  });

  it("le schéma versionné (migration 0000) est exactement celui que Better Auth attend", async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options);
    expect(toBeCreated.map((t) => t.table)).toEqual([]);
    expect(toBeAdded.map((t) => `${t.table}.${Object.keys(t.fields).join(",")}`)).toEqual([]);
  });

  it("aucun rôle applicatif (anon, authenticated, app_server, PUBLIC) n'a de droit sur les tables d'authentification", async () => {
    const rows = await adminSql()<{ grantee: string }[]>`
      select distinct grantee from information_schema.role_table_grants
      where table_schema = 'auth' and grantee not in ('auth_runtime', 'postgres')`;
    expect(rows).toEqual([]);
    const { id } = await register("closed");
    for (const table of ["sessions", "users", "accounts", "verifications"]) {
      const e = await failing(() => asUser({ id }, (tx) => tx.unsafe(`select * from auth.${table} limit 1`)));
      expect(e.code, table).toBe("42501");
    }
  });

  it("BA ↔ RLS : un utilisateur Better Auth crée un club, un autre n'y accède pas ; invitation acceptée seulement si l'e-mail est vérifié", async () => {
    const owner = await register("owner");
    const other = await register("autre");
    const academy = await createAcademy({ id: owner.id, email: owner.email }, "Club BA");
    const seen = await asUser({ id: other.id }, (tx) => tx`select id from public.academies`);
    expect(seen).toHaveLength(0);

    const joiner = await register("joiner", false); // e-mail NON vérifié
    const token = randomBytes(32).toString("hex");
    await asUser({ id: owner.id }, (tx) => tx`select public.create_invitation(${academy}, ${joiner.email}, 'coach', null, ${token})`);
    const refused = await failing(() => asUser({ id: joiner.id }, (tx) => tx`select public.accept_invitation(${token})`));
    expect(refused.message).toContain("email_not_confirmed");
    await verifyLink(joiner.email);
    const [ok] = await asUser({ id: joiner.id }, (tx) => tx<{ id: string }[]>`select public.accept_invitation(${token}) as id`);
    expect(ok!.id).toBe(academy);
    const [m] = await adminSql()<{ role: string }[]>`select role from public.academy_memberships where user_id = ${joiner.id}`;
    expect(m!.role).toBe("coach");
    // Une invitation destinée à une autre adresse reste inopérante.
    const intruder = await register("intrus");
    const t2 = randomBytes(32).toString("hex");
    await asUser({ id: owner.id }, (tx) => tx`select public.create_invitation(${academy}, ${mailAddress("destinataire")}, 'member', null, ${t2})`);
    const e2 = await failing(() => asUser({ id: intruder.id }, (tx) => tx`select public.accept_invitation(${t2})`));
    expect(e2.message).toContain("invitation_invalid");
  });

  it("suppression de compte : l'utilisateur, ses sessions et ses comptes d'authentification disparaissent", async () => {
    const { email, id } = await register("del");
    const { cookie } = await signInCookie(email);
    await asUser({ id }, (tx) => tx`select public.delete_my_account()`);
    const left = await adminSql()<{ n: number }[]>`
      select (select count(*) from auth.users where id = ${id})::int + (select count(*) from auth.sessions where user_id = ${id})::int
           + (select count(*) from auth.accounts where user_id = ${id})::int + (select count(*) from public.profiles where id = ${id})::int as n`;
    expect(left[0]!.n).toBe(0);
    expect(await sessionOf(cookie)).toBeNull();
  });

  it("purge : sessions et jetons expirés supprimés, valides conservés ; seule app_server peut l'appeler", async () => {
    const { email, id } = await register("purge");
    await signInCookie(email);
    await adminSql()`insert into auth.sessions (expires_at, token, updated_at, user_id) values (now() - interval '1 day', ${randomBytes(8).toString("hex")}, now(), ${id})`;
    await adminSql()`insert into auth.verifications (identifier, value, expires_at, updated_at) values ('x', 'y', now() - interval '1 day', now())`;
    const [r] = await appSql()<{ r: { auth_sessions_deleted: number; auth_verifications_deleted: number } }[]>`select app_private.purge_expired_auth() as r`;
    expect(r!.r.auth_sessions_deleted).toBeGreaterThanOrEqual(1);
    expect(r!.r.auth_verifications_deleted).toBeGreaterThanOrEqual(1);
    expect((await adminSql()`select 1 from auth.sessions where user_id = ${id}`).length).toBe(1);
    const e = await failing(() => pool.query("select app_private.purge_expired_auth()"));
    expect(e.code).toBe("42501");
  });
});
