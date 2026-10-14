import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { safeLog } from "@/server/auth/factory";
import { outboxMailer } from "@/server/mail/outbox";
import { MailDeliveryError, resendMailer } from "@/server/mail/resend";
import { bookingPromotedEmail, passwordResetEmail, verificationEmail } from "@/server/mail/templates";

const LINK = "https://club.example/api/auth/verify-email?token=abc.def.ghi&callbackURL=%2Flogin";

describe("modèles d'e-mails", () => {
  it("ne contiennent que le destinataire, le lien et un texte générique (aucun nom de club ni donnée métier)", () => {
    const m = verificationEmail("alice@example.invalid", LINK);
    expect(m.kind).toBe("verification");
    expect(m.text).toContain(LINK);
    expect(m.html).toContain("verify-email?token=abc.def.ghi");
    expect(m.subject).not.toMatch(/alice/i);
    expect(m.text).not.toContain("alice");
    expect(passwordResetEmail("a@example.invalid", LINK).text).toMatch(/1 heure/);
  });

  it("échappent le HTML du lien (pas d'injection)", () => {
    const evil = 'https://x.example/"><script>alert(1)</script>';
    const html = verificationEmail("a@example.invalid", evil).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("e-mail de place confirmée (promotion depuis la liste d'attente)", () => {
  const ME = "https://club.example/a/7d1c2a4e-0b6f-4c1e-9a55-3f2d8e9b1c00/me";
  // 17:00 UTC le mardi 20 octobre 2026 : 19:00 à Paris (heure d'été), 13:00 à Montréal.
  const promo = { academyName: "Gracie Lyon", className: "JJB débutants", startsAt: new Date("2026-10-20T17:00:00Z"), timeZone: "Europe/Paris", link: ME };

  it("donne le club, le cours, la date et l'heure dans le fuseau du club, et le lien vers l'espace adhérent", () => {
    const m = bookingPromotedEmail("ana@example.invalid", promo);
    expect(m).toMatchObject({ to: "ana@example.invalid", kind: "booking_promoted", link: ME });
    expect(m.subject).toBe("Place confirmée : JJB débutants, mardi 20 octobre à 19:00 — Matnexa");
    expect(m.text).toContain("« JJB débutants » du mardi 20 octobre à 19:00, au club « Gracie Lyon »");
    expect(m.text).toContain(`Voir mes séances : ${ME}`);
    expect(m.html).toContain(`href="${ME}"`);
    expect(bookingPromotedEmail("ana@example.invalid", { ...promo, timeZone: "America/Montreal" }).text).toContain("mardi 20 octobre à 13:00");
  });

  it("couvre la place libérée comme la place accordée, sans rien promettre d'autre ni citer l'adhérent", () => {
    const m = bookingPromotedEmail("ana@example.invalid", promo);
    expect(m.text).toMatch(/Une place vous a été attribuée : votre réservation est confirmée\./);
    expect(m.text).toMatch(/annulez votre réservation depuis votre espace pour libérer la place/);
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/ana@|rappel|garanti|rang|n°/i);
  });

  it("échappe le HTML des noms et garde l'objet sur une seule ligne", () => {
    const m = bookingPromotedEmail("a@example.invalid", { ...promo, academyName: 'Club <script>alert(1)</script>', className: "JJB\r\nBcc: x@evil.example" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain("JJB Bcc: x@evil.example");
  });
});

describe("adaptateur Resend (faux fetch : aucun appel réseau)", () => {
  it("envoie POST /emails avec la clé en Bearer et un corps conforme, sans suivre d'autre hôte", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    const mailer = resendMailer({ apiKey: "re_cle_de_test", from: "Coach OS <no-reply@club.example>", fetchImpl: fetchImpl as unknown as typeof fetch });
    await mailer.send(verificationEmail("alice@example.invalid", LINK));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_cle_de_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Coach OS <no-reply@club.example>", to: ["alice@example.invalid"] });
    expect(body.text).toContain(LINK);
    expect(Object.keys(body).sort()).toEqual(["from", "html", "subject", "text", "to"]);
  });

  it("une erreur du fournisseur ne transporte ni destinataire, ni contenu, ni réponse", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "alice@example.invalid invalide" }), { status: 429, headers: { "retry-after": "7" } }));
    const mailer = resendMailer({ apiKey: "re_cle_de_test", from: "x@club.example", fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = await mailer.send(verificationEmail("alice@example.invalid", LINK)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailDeliveryError);
    expect((error as MailDeliveryError).status).toBe(429);
    expect((error as MailDeliveryError).retryAfter).toBe(7);
    expect(JSON.stringify(error) + String((error as Error).message)).not.toMatch(/alice|token|re_cle/);
  });
});

describe("boîte d'envoi de test", () => {
  it("écrit une ligne JSON par message et rien d'autre", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "coachos-outbox-"));
    const file = path.join(dir, "outbox.jsonl");
    try {
      await outboxMailer(file).send(passwordResetEmail("bob@example.invalid", LINK));
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ kind: "password_reset", to: "bob@example.invalid", link: LINK });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("journal d'authentification assaini", () => {
  it("masque e-mails, IP et longs jetons ; ne garde que le code d'erreur ; une seule ligne JSON", () => {
    const lines: string[] = [];
    const spies = [vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation((l: unknown) => void lines.push(String(l))));
    safeLog("error", "Failed for alice@example.invalid from 203.0.113.9 token abcdefghijklmnopqrstuvwxyz0123\nINJECTED", {
      code: "42P01",
      detail: "insert into secrets values ('alice@example.invalid')",
      query: "select 1",
    });
    spies.forEach((s) => s.mockRestore());
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    for (const forbidden of ["alice", "203.0.113.9", "abcdefghijklmnopqrstuvwxyz0123", "insert into", "select 1", "\n"]) expect(line.includes(forbidden), forbidden).toBe(false);
    expect(JSON.parse(line)).toMatchObject({ event: "auth.log", level: "error", code: "42P01" });
  });
});
