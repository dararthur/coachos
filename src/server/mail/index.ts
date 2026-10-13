import "server-only";
import { env } from "@/server/env";
import { outboxMailer } from "./outbox";
import { resendMailer } from "./resend";
import type { Mailer } from "./types";

let cached: Mailer | undefined;

/** Fournisseur choisi par MAIL_PROVIDER. Resend n'est contacté que si MAIL_PROVIDER=resend ET qu'une clé est configurée. */
export function getMailer(): Mailer {
  if (cached) return cached;
  const e = env();
  cached = e.MAIL_PROVIDER === "resend" ? resendMailer({ apiKey: e.RESEND_API_KEY!, from: e.MAIL_FROM! }) : outboxMailer(e.MAIL_OUTBOX_FILE!);
  return cached;
}
