/**
 * Port d'envoi d'e-mails transactionnels. Le reste de l'application ne connaît que cette interface :
 * le fournisseur (Resend) est un adaptateur interchangeable ; les tests utilisent la boîte d'envoi fichier.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Catégorie fonctionnelle (journalisation et tests) : jamais de donnée personnelle. */
  kind: "verification" | "password_reset" | "club_request" | "club_approved";
  /** Lien à usage sensible contenu dans le message (utilisé par la boîte d'envoi de test uniquement). */
  link: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
