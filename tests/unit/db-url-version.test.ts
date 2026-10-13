import { describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclaration de types
import { isLocalDatabaseUrl as isLocalMjs, sslViolation as sslMjs } from "../../scripts/lib/db-url.mjs";
// @ts-expect-error module .mjs sans déclaration de types
import { PG_MIN_MAJOR, PG_TARGET_MAJOR, assessPostgresVersion } from "../../scripts/lib/pg-version.mjs";
import { isLocalDatabaseUrl, sslViolation } from "@/server/db-url";

const CASES: [string, { databaseSslDisabled?: boolean }, boolean][] = [
  ["postgresql://u:p@127.0.0.1:5432/db", {}, true],
  ["postgresql://u:p@localhost/db", { databaseSslDisabled: true }, true],
  ["postgresql://u:p@[::1]:5432/db", {}, true],
  ["postgresql://u:p@db.exemple.fr/db?host=/var/run/postgresql", {}, true],
  ["postgresql://u:p@db.exemple.fr:5432/db", {}, false],
  ["postgresql://u:p@db.exemple.fr:5432/db?sslmode=disable", {}, false],
  ["postgresql://u:p@db.exemple.fr:5432/db?sslmode=prefer", {}, false],
  ["postgresql://u:p@db.exemple.fr:5432/db?sslmode=require", {}, false],
  ["postgresql://u:p@db.exemple.fr:5432/db?sslmode=require", { databaseSslDisabled: true }, false],
  ["postgresql://u:p@203.0.113.7:5432/db?sslmode=verify-full", {}, false],
];

describe("politique SSL des connexions (TypeScript et .mjs strictement identiques)", () => {
  it("rend le même verdict pour 10 configurations ; locale = dispensée, distante = sslmode requis", () => {
    for (const [url, opts] of CASES) {
      expect(sslViolation(url, opts), url).toBe(sslMjs(url, opts));
      expect(isLocalDatabaseUrl(url), url).toBe(isLocalMjs(url));
    }
    expect(sslViolation("postgresql://u:p@db.exemple.fr:5432/db?sslmode=require")).toBeNull();
    expect(sslViolation("postgresql://u:p@db.exemple.fr:5432/db?sslmode=verify-ca")).toBeNull();
    expect(sslViolation("postgresql://u:p@db.exemple.fr:5432/db")).toMatch(/sslmode=require/);
    expect(sslViolation("postgresql://u:p@db.exemple.fr:5432/db?sslmode=require", { databaseSslDisabled: true })).toMatch(/DATABASE_SSL=disable/);
    expect(sslViolation("postgresql://u:p@127.0.0.1/db", { databaseSslDisabled: true })).toBeNull();
    expect(sslViolation("n-importe-quoi")).toBeNull(); // URL invalide : signalée par ailleurs
  });

  it("les messages ne contiennent ni mot de passe ni hôte", () => {
    const why = sslViolation("postgresql://admin:Sup3rSecret@db-interne.exemple.fr:5432/db")!;
    expect(why).not.toContain("Sup3rSecret");
    expect(why).not.toContain("db-interne");
  });
});

describe("politique de version PostgreSQL", () => {
  it("17 = cible testée ; 15, 16 et 18 = autorisées mais non testées ; < 15 ou illisible = refusées", () => {
    expect(PG_TARGET_MAJOR).toBe(17);
    expect(PG_MIN_MAJOR).toBe(15);
    expect(assessPostgresVersion(170010)).toMatchObject({ level: "ok", major: 17 });
    expect(assessPostgresVersion("170004")).toMatchObject({ level: "ok", major: 17 });
    for (const num of [150008, 160004, 180001]) expect(assessPostgresVersion(num).level, String(num)).toBe("untested");
    for (const num of [140012, 130000, 90600]) expect(assessPostgresVersion(num).level, String(num)).toBe("unsupported");
    expect(assessPostgresVersion("abc").level).toBe("unsupported");
    expect(assessPostgresVersion(180001).message).toMatch(/CI/);
  });
});
