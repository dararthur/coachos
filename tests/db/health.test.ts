import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSql, closeAll } from "./support";
import { defaultProbes, resetReadinessCache, runReadiness } from "@/server/health";

const rand = () => randomBytes(24).toString("hex");

describe("disponibilité contre un vrai PostgreSQL", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      APP_ENV: "test",
      SITE_URL: "http://127.0.0.1:3999",
      MAIL_PROVIDER: "outbox",
      MAIL_OUTBOX_FILE: path.join(tmpdir(), `coachos-health-${rand().slice(0, 8)}.jsonl`),
      APP_SECRET: rand(),
      BETTER_AUTH_SECRET: rand(),
      DATABASE_URL: process.env.TEST_APP_DATABASE_URL,
      AUTH_DATABASE_URL: process.env.TEST_AUTH_DATABASE_URL,
    });
    resetReadinessCache();
  });
  afterAll(async () => {
    const { getSql } = await import("@/server/db/client");
    const { getAuthPool } = await import("@/server/auth/auth");
    await getSql().end();
    await getAuthPool().end();
    await closeAll();
  });

  it("prêt quand la configuration, la base applicative et la base d'authentification sont en ordre", async () => {
    expect(await runReadiness(defaultProbes())).toEqual({ ok: true, failed: [] });
  });

  it("indisponible si app_server perd l'usage du rôle authenticated (chemin réel des requêtes), puis rétabli", async () => {
    const admin = adminSql();
    await admin`revoke authenticated from app_server`;
    try {
      expect(await runReadiness(defaultProbes())).toEqual({ ok: false, failed: ["app_db"] });
    } finally {
      await admin`grant authenticated to app_server`;
    }
    expect((await runReadiness(defaultProbes())).ok).toBe(true);
  });

  it("indisponible si auth_runtime perd le droit sur les tables d'authentification, puis rétabli", async () => {
    const admin = adminSql();
    await admin`revoke select on auth.users from auth_runtime`;
    try {
      expect(await runReadiness(defaultProbes())).toEqual({ ok: false, failed: ["auth_db"] });
    } finally {
      await admin`grant select on auth.users to auth_runtime`;
    }
    expect((await runReadiness(defaultProbes())).ok).toBe(true);
  });
});
