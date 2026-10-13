import type { Mailer, MailMessage } from "./types";

export class MailDeliveryError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null,
  ) {
    super(`mail_delivery_failed status=${status}`); // jamais le destinataire, le corps ni la réponse du fournisseur
    this.name = "MailDeliveryError";
  }
}

export interface ResendOptions {
  apiKey: string;
  from: string;
  /** Injectable : les tests fournissent un faux `fetch` (AUCUN appel réseau n'est effectué par la suite de tests). */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Adaptateur Resend (API REST, `POST /emails`). NON vérifié contre l'API réelle : aucun compte n'a été créé ni appel émis.
 * La forme de la requête est décrite par la documentation officielle (voir docs/self-hosted-auth.md) et figée par tests/unit/mail.test.ts.
 * Les erreurs ne transportent ni destinataire, ni contenu, ni réponse du fournisseur.
 */
export function resendMailer(o: ResendOptions): Mailer {
  const f = o.fetchImpl ?? fetch;
  const base = o.baseUrl ?? "https://api.resend.com";
  return {
    async send(m: MailMessage) {
      const res = await f(`${base}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        const retry = Number(res.headers.get("retry-after"));
        throw new MailDeliveryError(res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
      }
    },
  };
}
