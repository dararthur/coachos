import "server-only";
import { env } from "@/server/env";
import { countMetric } from "@/server/monitoring";
import { outboxMailer } from "./outbox";
import { resendMailer } from "./resend";
import type { Mailer } from "./types";

let cached: Mailer | undefined;

/** Compte les envois réussis et en échec (supervision), sans jamais changer le comportement : l'erreur est relancée telle quelle. */
function counted(inner: Mailer): Mailer {
  return {
    async send(message) {
      try {
        await inner.send(message);
      } catch (error) {
        void countMetric("mail_failed");
        throw error;
      }
      void countMetric("mail_sent");
    },
  };
}

/** Fournisseur choisi par MAIL_PROVIDER. Resend n'est contacté que si MAIL_PROVIDER=resend ET qu'une clé est configurée. */
export function getMailer(): Mailer {
  if (cached) return cached;
  const e = env();
  cached = counted(e.MAIL_PROVIDER === "resend" ? resendMailer({ apiKey: e.RESEND_API_KEY!, from: e.MAIL_FROM! }) : outboxMailer(e.MAIL_OUTBOX_FILE!));
  return cached;
}
