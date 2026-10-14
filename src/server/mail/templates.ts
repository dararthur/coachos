import type { MailMessage } from "./types";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Contenu minimal : ni nom de club, ni donnée métier, ni liste. Un seul lien à usage sensible, durée de vie rappelée.
 * (Le contenu des e-mails est conservé 30 jours par le fournisseur : voir docs/privacy-gdpr.md.)
 */
function layout(title: string, intro: string, action: string, link: string, outro: string): { text: string; html: string } {
  const text = `${title}\n\n${intro}\n\n${action} : ${link}\n\n${outro}\n\nMatnexa`;
  // Couleurs de la marque (DESIGN.md) : encre #16191d, orange #c2410c (texte blanc 5,2:1), texte secondaire #585d64.
  const html = `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#16191d;background:#ffffff">
<p style="font-size:16px;font-weight:700;letter-spacing:-0.01em;margin:0 0 20px">Matnexa</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#c2410c;color:#ffffff;border-radius:4px;font-weight:600;text-decoration:none">${escapeHtml(action)}</a></p>
<p style="font-size:13px;color:#585d64">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(link)}</p>
<p style="font-size:13px;color:#585d64">${escapeHtml(outro)}</p></body></html>`;
  return { text, html };
}

export function verificationEmail(to: string, link: string): MailMessage {
  const body = layout(
    "Confirmez votre adresse e-mail",
    "Vous venez de créer un compte Matnexa. Confirmez votre adresse e-mail pour pouvoir vous connecter.",
    "Confirmer mon adresse",
    link,
    "Ce lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera activé.",
  );
  return { to, kind: "verification", subject: "Confirmez votre adresse e-mail — Matnexa", link, ...body };
}

export function passwordResetEmail(to: string, link: string): MailMessage {
  const body = layout(
    "Réinitialisation de votre mot de passe",
    "Une réinitialisation du mot de passe de votre compte Matnexa a été demandée.",
    "Choisir un nouveau mot de passe",
    link,
    "Ce lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
  );
  return { to, kind: "password_reset", subject: "Réinitialisation de votre mot de passe — Matnexa", link, ...body };
}

/** À l'administrateur de la plateforme : une demande de club attend sa décision. Le lien mène à la page d'administration (connexion requise). */
export function clubRequestEmail(to: string, link: string, request: { clubName: string; contactName: string; contactEmail: string }): MailMessage {
  const body = layout(
    "Nouvelle demande de création de club",
    `${request.contactName} (${request.contactEmail}) demande la création du club « ${request.clubName} ». Rien n'est créé tant que vous n'avez pas approuvé la demande.`,
    "Examiner la demande",
    link,
    "Connexion avec votre compte administrateur requise. Si cette demande vous semble suspecte, refusez-la ou ignorez ce message.",
  );
  return { to, kind: "club_request", subject: "Demande de création de club — Matnexa", link, ...body };
}

/** Au demandeur : sa demande est approuvée, il peut créer son compte (ou se connecter s'il en a déjà un). */
export function clubApprovedEmail(to: string, link: string, clubName: string): MailMessage {
  const body = layout(
    "Votre demande de club est approuvée",
    `La création du club « ${clubName} » est approuvée. Créez votre compte avec cette adresse e-mail (ou connectez-vous si vous en avez déjà un), confirmez votre adresse, puis créez votre club.`,
    "Créer mon compte",
    link,
    "Ce message n'est valable que pour l'adresse à laquelle il a été envoyé. Si vous n'êtes pas à l'origine de cette demande, ignorez-le.",
  );
  return { to, kind: "club_approved", subject: "Votre club est approuvé — Matnexa", link, ...body };
}
