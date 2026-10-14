import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const rand = () => randomBytes(24).toString("hex");

/** Configuration de TEST autorisée : APP_ENV=test, boîte d'envoi, SITE_URL locale. */
const testConfig = (): Record<string, string> => ({
  NODE_ENV: "production", // les tests e2e tournent aussi en mode production : NODE_ENV ne distingue rien
  APP_ENV: "test",
  DATABASE_URL: `postgresql://app_server:${rand()}@127.0.0.1:5432/coachos`,
  AUTH_DATABASE_URL: `postgresql://auth_runtime:${rand()}@127.0.0.1:5432/coachos`,
  SITE_URL: "http://127.0.0.1:3100",
  APP_SECRET: rand(),
  BETTER_AUTH_SECRET: rand(),
  MAIL_PROVIDER: "outbox",
  MAIL_OUTBOX_FILE: "/tmp/boite-d-envoi-de-test.jsonl",
});

/** Configuration de production valide : https, Resend, aucune boîte d'envoi. */
const prodConfig = (): Record<string, string> => {
  const cfg = testConfig();
  delete cfg.MAIL_OUTBOX_FILE;
  return { ...cfg, APP_ENV: "production", SITE_URL: "https://coach.example.invalid", MAIL_PROVIDER: "resend", RESEND_API_KEY: `re_${rand()}`, MAIL_FROM: "Coach OS <no-reply@coach.example.invalid>", PLATFORM_ADMIN_EMAIL: "admin@coach.example.invalid" };
};

const refusal = (patch: Record<string, string | undefined>, base = testConfig()): string => {
  try {
    parseEnv({ ...base, ...patch });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("la configuration aurait dû être refusée");
};

describe("configuration : e-mail de test interdit hors développement et tests", () => {
  it("accepte la configuration de test explicite (APP_ENV=test + outbox + SITE_URL locale), même en NODE_ENV=production", () => {
    expect(parseEnv(testConfig()).MAIL_PROVIDER).toBe("outbox");
    expect(parseEnv({ ...testConfig(), APP_ENV: "development", SITE_URL: "http://localhost:4747" }).APP_ENV).toBe("development");
  });

  it("accepte une configuration de production complète (Resend, https)", () => {
    const e = parseEnv(prodConfig());
    expect(e.APP_ENV).toBe("production");
    expect(e.MAIL_PROVIDER).toBe("resend");
  });

  it("REFUSE MAIL_PROVIDER=outbox avec APP_ENV=production ou staging, même en NODE_ENV=production", () => {
    for (const appEnv of ["production", "staging"]) {
      const msg = refusal({ APP_ENV: appEnv, SITE_URL: "https://coach.example.invalid" });
      expect(msg, appEnv).toMatch(/outbox/);
      expect(msg, appEnv).toMatch(new RegExp(`APP_ENV=${appEnv}`));
    }
    expect(refusal({ APP_ENV: "production" })).toMatch(/outbox/); // même avec une SITE_URL locale
  });

  it("REFUSE la boîte d'envoi pour une instance publique, même si APP_ENV=test ou development (la dérogation ne vaut que pour une SITE_URL locale)", () => {
    for (const appEnv of ["test", "development"]) {
      for (const site of ["https://coach.example.invalid", "http://203.0.113.10:3000", "http://coach.example.invalid"]) {
        expect(refusal({ APP_ENV: appEnv, SITE_URL: site }), `${appEnv} ${site}`).toMatch(/SITE_URL locale/);
      }
    }
  });

  it("REFUSE APP_ENV absent, vide ou inconnu : le rôle d'une instance n'est jamais deviné", () => {
    expect(refusal({ APP_ENV: undefined })).toMatch(/APP_ENV/);
    expect(refusal({ APP_ENV: "" })).toMatch(/APP_ENV/);
    expect(refusal({ APP_ENV: "prod" })).toMatch(/APP_ENV/);
    expect(refusal({ APP_ENV: "Production" })).toMatch(/APP_ENV/);
  });

  it("exige MAIL_OUTBOX_FILE avec outbox, et clé + expéditeur avec resend", () => {
    expect(refusal({ MAIL_OUTBOX_FILE: undefined })).toMatch(/MAIL_OUTBOX_FILE/);
    expect(refusal({ RESEND_API_KEY: undefined }, prodConfig())).toMatch(/RESEND_API_KEY/);
    expect(refusal({ MAIL_FROM: undefined }, prodConfig())).toMatch(/MAIL_FROM/);
    expect(refusal({ MAIL_PROVIDER: "smtp" }, prodConfig())).toMatch(/MAIL_PROVIDER/);
  });
});

describe("configuration : autres refus au démarrage", () => {
  it("production exige https ; secrets distincts et d'au moins 32 caractères ; URL de base obligatoires", () => {
    expect(refusal({ SITE_URL: "http://coach.example.invalid" }, prodConfig())).toMatch(/https obligatoire/);
    expect(refusal({ SITE_URL: "http://127.0.0.1:3000" }, prodConfig())).toMatch(/https obligatoire/); // pas même en loopback avec APP_ENV=production
    const same = rand();
    expect(refusal({ APP_SECRET: same, BETTER_AUTH_SECRET: same })).toMatch(/distinct/);
    expect(refusal({ BETTER_AUTH_SECRET: "court" })).toMatch(/BETTER_AUTH_SECRET/);
    expect(refusal({ APP_SECRET: "court" })).toMatch(/APP_SECRET/);
    for (const name of ["DATABASE_URL", "AUTH_DATABASE_URL", "SITE_URL", "MAIL_PROVIDER"]) expect(refusal({ [name]: undefined }), name).toContain(name);
  });

  it("une configuration entièrement absente est refusée, en nommant les variables manquantes", () => {
    let msg = "";
    try {
      parseEnv({});
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const name of ["APP_ENV", "DATABASE_URL", "AUTH_DATABASE_URL", "SITE_URL", "APP_SECRET", "BETTER_AUTH_SECRET", "MAIL_PROVIDER"]) expect(msg).toContain(name);
  });

  it("une variable vide (NOM= copié de .env.example) vaut « absente » : facultative OK, obligatoire refusée", () => {
    expect(parseEnv({ ...testConfig(), CRON_SECRET: "", CHECKIN_TOKEN_TTL_SECONDS: "" }).CRON_SECRET).toBeUndefined();
    expect(refusal({ APP_SECRET: "" })).toMatch(/APP_SECRET/);
    expect(refusal({ CRON_SECRET: "trop-court" })).toMatch(/CRON_SECRET/); // renseignée mais invalide : refusée
  });

  it("les messages de refus ne contiennent JAMAIS de valeur de configuration", () => {
    const base = prodConfig();
    const cfg: Record<string, string> = { ...base, MAIL_PROVIDER: "outbox", MAIL_OUTBOX_FILE: "/tmp/x", BETTER_AUTH_SECRET: base.APP_SECRET! };
    const msg = refusal({}, cfg);
    for (const key of ["APP_SECRET", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "DATABASE_URL", "AUTH_DATABASE_URL"]) {
      expect(msg.includes(cfg[key] ?? "§absent§"), key).toBe(false);
    }
    expect(msg).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe("configuration : SSL des bases de données dans les instances déployées", () => {
  const remote = (mode = "") => ({ DATABASE_URL: `postgresql://app_server:${rand()}@db.exemple.fr:5432/coachos${mode}`, AUTH_DATABASE_URL: `postgresql://auth_runtime:${rand()}@db.exemple.fr:5432/coachos${mode}` });

  it("production et staging REFUSENT de démarrer avec une base distante sans sslmode (les DEUX URL), ou avec DATABASE_SSL=disable", () => {
    for (const appEnv of ["production", "staging"]) {
      const base = { ...prodConfig(), APP_ENV: appEnv };
      expect(refusal(remote(), base), appEnv).toMatch(/DATABASE_URL.*sslmode=require/);
      expect(refusal(remote(), base), appEnv).toMatch(/AUTH_DATABASE_URL.*sslmode=require/);
      expect(refusal({ ...remote("?sslmode=require"), DATABASE_SSL: "disable" }, base)).toMatch(/DATABASE_SSL=disable/);
      expect(refusal({ ...remote("?sslmode=prefer") }, base)).toMatch(/sslmode=require/);
      expect(parseEnv({ ...base, ...remote("?sslmode=require") }).APP_ENV).toBe(appEnv);
      expect(parseEnv({ ...base, ...remote("?sslmode=verify-full") }).APP_ENV).toBe(appEnv);
    }
  });

  it("la boucle locale reste dispensée en production ; le développement et les tests ne sont pas contraints", () => {
    expect(parseEnv(prodConfig()).APP_ENV).toBe("production"); // 127.0.0.1 sans sslmode
    expect(parseEnv({ ...prodConfig(), DATABASE_SSL: "disable" }).APP_ENV).toBe("production");
    expect(parseEnv({ ...testConfig(), ...remote() }).APP_ENV).toBe("test");
  });
});

describe("configuration : administrateur de la plateforme", () => {
  it("est obligatoire en staging et en production, optionnelle en développement et en test", () => {
    expect(parseEnv(testConfig()).PLATFORM_ADMIN_EMAIL).toBeUndefined();
    expect(parseEnv(prodConfig()).PLATFORM_ADMIN_EMAIL).toBe("admin@coach.example.invalid");
    expect(refusal({ PLATFORM_ADMIN_EMAIL: undefined }, prodConfig())).toMatch(/PLATFORM_ADMIN_EMAIL/);
    expect(refusal({ APP_ENV: "staging", PLATFORM_ADMIN_EMAIL: undefined }, prodConfig())).toMatch(/PLATFORM_ADMIN_EMAIL/);
  });

  it("une valeur invalide est refusée sans jamais être répétée dans le message", () => {
    const message = refusal({ PLATFORM_ADMIN_EMAIL: "pas-une-adresse-secrete" }, prodConfig());
    expect(message).toMatch(/PLATFORM_ADMIN_EMAIL/);
    expect(message).not.toContain("pas-une-adresse-secrete");
  });
});
