// Faux serveur GoTrue (Supabase Auth) MINIMAL, réservé aux tests e2e locaux sans Docker.
// Il implémente uniquement les routes appelées par @supabase/ssr / supabase-js dans Coach OS :
// signup, token (password / refresh_token), user (GET/PUT), logout, recover. Confirmation e-mail désactivée.
// NE PAS utiliser en production : ce n'est pas une implémentation de sécurité d'Auth.
import http from "node:http";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import postgres from "postgres";

const b64 = (v) => Buffer.from(v).toString("base64url");

function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored ?? "").split(":");
  if (!salt || !hash) return false;
  const given = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(hash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function startMockAuth({ port, adminUrl }) {
  const jwtSecret = randomBytes(32).toString("hex");
  const sql = postgres(adminUrl, { max: 2, onnotice: () => {} });
  const refreshTokens = new Map(); // refresh_token -> user id
  const emailLog = []; // « e-mails » envoyés (reset) — consultables par les tests

  const sign = (payload) => {
    const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64(JSON.stringify(payload));
    const sig = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url");
    return `${head}.${body}.${sig}`;
  };
  const verify = (token) => {
    const [h, p, s] = String(token).split(".");
    if (!h || !p || !s) return null;
    const expected = createHmac("sha256", jwtSecret).update(`${h}.${p}`).digest("base64url");
    if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    return payload.exp * 1000 > Date.now() ? payload : null;
  };

  const userObject = (row) => ({
    id: row.id, aud: "authenticated", role: "authenticated", email: row.email,
    email_confirmed_at: row.email_confirmed_at, phone: "", confirmed_at: row.email_confirmed_at,
    last_sign_in_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {}, identities: [], created_at: row.created_at, updated_at: new Date().toISOString(),
  });
  const session = (row) => {
    const now = Math.floor(Date.now() / 1000);
    const access = sign({ aud: "authenticated", exp: now + 3600, iat: now, sub: row.id, email: row.email, role: "authenticated", session_id: randomUUID(), aal: "aal1" });
    const refresh = randomBytes(12).toString("hex");
    refreshTokens.set(refresh, row.id);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userObject(row) };
  };

  const readBody = (req) => new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const err = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });
  const rowByEmail = async (email) => (await sql`select * from auth.users where email = ${email}`)[0];
  const rowById = async (id) => (await sql`select * from auth.users where id = ${id}`)[0];
  const bearerUser = async (req) => {
    const payload = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    return payload ? await rowById(payload.sub) : null;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const path = url.pathname.replace(/^\/auth\/v1/, "");
      if (req.method === "GET" && path === "/__emails") return send(res, 200, emailLog);
      if (req.method === "POST" && path === "/signup") {
        const body = await readBody(req);
        const email = String(body.email ?? "").toLowerCase();
        if (!email || String(body.password ?? "").length < 12) return err(res, 422, "weak_password", "Password should be at least 12 characters.");
        if (await rowByEmail(email)) return err(res, 422, "user_already_exists", "User already registered");
        const [row] = await sql`
          insert into auth.users (email, email_confirmed_at, encrypted_password, raw_user_meta_data)
          values (${email}, now(), ${hashPassword(body.password)}, ${sql.json(body.data ?? {})}) returning *`;
        return send(res, 200, session(row));
      }
      if (req.method === "POST" && path === "/token") {
        const grant = url.searchParams.get("grant_type");
        const body = await readBody(req);
        if (grant === "password") {
          const row = await rowByEmail(String(body.email ?? "").toLowerCase());
          if (!row || !verifyPassword(String(body.password ?? ""), row.encrypted_password)) return err(res, 400, "invalid_credentials", "Invalid login credentials");
          return send(res, 200, session(row));
        }
        if (grant === "refresh_token") {
          const id = refreshTokens.get(body.refresh_token);
          const row = id ? await rowById(id) : null;
          if (!row) return err(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
          refreshTokens.delete(body.refresh_token);
          return send(res, 200, session(row));
        }
        return err(res, 400, "unsupported_grant_type", "unsupported");
      }
      if (path === "/user" && req.method === "GET") {
        const row = await bearerUser(req);
        return row ? send(res, 200, userObject(row)) : err(res, 401, "bad_jwt", "invalid JWT");
      }
      if (path === "/user" && req.method === "PUT") {
        const row = await bearerUser(req);
        if (!row) return err(res, 401, "bad_jwt", "invalid JWT");
        const body = await readBody(req);
        if (body.password) {
          if (String(body.password).length < 12) return err(res, 422, "weak_password", "weak");
          await sql`update auth.users set encrypted_password = ${hashPassword(body.password)} where id = ${row.id}`;
        }
        if (body.data) await sql`update auth.users set raw_user_meta_data = ${sql.json({ ...(row.raw_user_meta_data ?? {}), ...body.data })} where id = ${row.id}`;
        return send(res, 200, userObject(await rowById(row.id)));
      }
      if (path === "/logout") return send(res, 204);
      if (path === "/recover" && req.method === "POST") {
        const body = await readBody(req);
        if (await rowByEmail(String(body.email ?? "").toLowerCase())) emailLog.push({ type: "recover", to: body.email });
        return send(res, 200, {});
      }
      return err(res, 404, "not_found", `no mock route ${req.method} ${path}`);
    } catch (e) {
      return err(res, 500, "mock_error", String(e?.message ?? e));
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await sql.end();
    },
  };
}
