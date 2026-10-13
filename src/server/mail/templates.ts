import type { MailMessage } from "./types";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Contenu minimal : ni nom de club, ni donnée métier, ni liste. Un seul lien à usage sensible, durée de vie rappelée.
 * (Le contenu des e-mails est conservé 30 jours par le fournisseur : voir docs/privacy-gdpr.md.)
 */
function layout(title: string, intro: string, action: string, link: string, outro: string): { text: string; html: string } {
  const text = `${title}\n\n${intro}\n\n${action} : ${link}\n\n${outro}\n\nCoach OS`;
  const html = `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
<h1 style="font-size:18px">${escapeHtml(title)}</h1>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(action)}</a></p>
<p style="font-size:13px;color:#475569">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(link)}</p>
<p style="font-size:13px;color:#475569">${escapeHtml(outro)}</p></body></html>`;
  return { text, html };
}

export function verificationEmail(to: string, link: string): MailMessage {
  const body = layout(
    "Confirmez votre adresse e-mail",
    "Vous venez de créer un compte Coach OS. Confirmez votre adresse e-mail pour pouvoir vous connecter.",
    "Confirmer mon adresse",
    link,
    "Ce lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera activé.",
  );
  return { to, kind: "verification", subject: "Confirmez votre adresse e-mail — Coach OS", link, ...body };
}

export function passwordResetEmail(to: string, link: string): MailMessage {
  const body = layout(
    "Réinitialisation de votre mot de passe",
    "Une réinitialisation du mot de passe de votre compte Coach OS a été demandée.",
    "Choisir un nouveau mot de passe",
    link,
    "Ce lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
  );
  return { to, kind: "password_reset", subject: "Réinitialisation de votre mot de passe — Coach OS", link, ...body };
}
