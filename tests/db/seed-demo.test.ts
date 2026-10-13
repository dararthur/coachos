import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as dashboard from "@/server/repositories/dashboard";
import { adminSql, asUser, closeAll, createAcademy, createUser } from "./support";

const script = path.resolve(import.meta.dirname, "../../scripts/seed-demo.mjs");
let academy: string;
let owner: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  owner = await createUser("seed-owner");
  academy = await createAcademy(owner, "Club démo");
});
afterAll(closeAll);

const run = (extra: string[], url = process.env.TEST_ADMIN_DATABASE_URL!) =>
  execFileSync(process.execPath, [script, "--academy", academy, ...extra], { env: { ...process.env, SEED_DATABASE_URL: url }, encoding: "utf8" });

describe("données de démonstration synthétiques", () => {
  it("crée des données étiquetées, cohérentes avec le tableau de bord, idempotentes et purgeables", async () => {
    expect(run([])).toMatch(/40 membres/);
    const [{ n }] = await adminSql()<[{ n: number }]>`select count(*)::int as n from public.people where academy_id = ${academy} and external_ref like 'demo-%' and email like '%@example.invalid'`;
    expect(n).toBe(40);
    const [{ notes }] = await adminSql()<[{ notes: number }]>`select count(*)::int as notes from public.sessions where academy_id = ${academy} and notes = '[DÉMO SYNTHÉTIQUE]'`;
    expect(notes).toBeGreaterThan(15);

    const stats = await asUser(owner, (tx) => dashboard.getDashboardStats(tx, academy, "Europe/Paris"));
    expect(stats.activeMembers).toBe(38); // 40 - 2 archivés
    expect(stats.weekly.reduce((a, w) => a + w.attended, 0)).toBeGreaterThan(100);
    expect(stats.inactive30).toBeGreaterThan(0); // des « décrocheurs » existent

    expect(run([])).toMatch(/existent déjà/);
    expect(run(["--purge"])).toMatch(/Purge : 40 membres/);
    expect((await adminSql()`select 1 from public.people where academy_id = ${academy}`)).toHaveLength(0);
  });

  it("refuse une base non locale et un identifiant invalide", () => {
    const remote = spawnSync(process.execPath, [script, "--academy", academy], { env: { ...process.env, SEED_DATABASE_URL: "postgresql://u:p@db.example.com:5432/x" }, encoding: "utf8" });
    expect(remote.status).toBe(2);
    expect(remote.stderr).toMatch(/pas une base locale/);
    const bad = spawnSync(process.execPath, [script, "--academy", "pas-un-uuid"], { env: { ...process.env, SEED_DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL }, encoding: "utf8" });
    expect(bad.status).toBe(2);
  });
});
