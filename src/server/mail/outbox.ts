import { appendFileSync } from "node:fs";
import type { Mailer, MailMessage } from "./types";

/**
 * Adaptateur de TEST : « envoie » l'e-mail en ajoutant une ligne JSON à un fichier (destinataire, catégorie, lien).
 * Aucun réseau. Refusé par le préflight pour un vrai pilote. N'écrit RIEN dans les journaux du serveur.
 */
export function outboxMailer(file: string): Mailer {
  return {
    async send(m: MailMessage) {
      appendFileSync(file, JSON.stringify({ kind: m.kind, to: m.to, subject: m.subject, link: m.link }) + "\n");
    },
  };
}
