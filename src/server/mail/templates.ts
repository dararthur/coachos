import { formatDay, formatTime } from "@/domain/dates";
import type { MailMessage } from "./types";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Une seule ligne, sans caractère de contrôle (nom de club ou de cours repris dans l'objet). */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Contenu minimal : un titre, un paragraphe, un seul lien. Les e-mails d'authentification ne citent ni club ni donnée métier
 * (lien à usage sensible, durée de vie rappelée) ; les autres ne citent que ce que le destinataire doit savoir (demande de club ;
 * place confirmée : club, cours et horaire).
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

/** Au responsable légal d'un mineur : lien de confirmation de son accord. Ne cite que le prénom de l'enfant et le club. */
export function guardianConsentEmail(to: string, link: string, info: { childFirstName: string; academyName: string }): MailMessage {
  const child = oneLine(info.childFirstName);
  const club = oneLine(info.academyName);
  const body = layout(
    "Accord du responsable légal",
    `Le club « ${club} » aimerait inscrire ${child} sur Matnexa pour suivre ses présences aux cours. Comme vous êtes son responsable légal, nous avons besoin de votre accord. Aucune donnée de santé n'est demandée, et le classement comme la photo restent désactivés.`,
    "Confirmer mon accord",
    link,
    "Ce lien est valable 14 jours. Si vous n'êtes pas le responsable légal de cet enfant ou si vous ne souhaitez pas cette inscription, ignorez ce message et prévenez le club.",
  );
  return { to, kind: "guardian_consent", subject: `Accord pour l'inscription de ${child} — ${club}`, link, ...body };
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

export interface BookingPromotion {
  academyName: string;
  className: string;
  startsAt: Date;
  /** Fuseau du club : la date et l'heure sont celles affichées dans l'application. */
  timeZone: string;
  /** Espace adhérent du club (`/a/<academyId>/me`), où la réservation se consulte et s'annule. */
  link: string;
}

/**
 * Place attribuée depuis la liste d'attente, qu'elle se soit libérée ou que le coach l'ait accordée : la formulation couvre
 * les deux cas. Ni le nom de l'adhérent, ni les autres inscrits, ni rang ou capacité.
 */
/** Séance annulée : même contenu minimal que la place confirmée (aucun nom, aucun autre inscrit). */
export function sessionCancelledEmail(to: string, p: BookingPromotion): MailMessage {
  const className = oneLine(p.className);
  const when = `${formatDay(p.startsAt, p.timeZone)} à ${formatTime(p.startsAt, p.timeZone)}`;
  const body = layout(
    "Séance annulée",
    `Le cours « ${className} » du ${when}, au club « ${oneLine(p.academyName)} », est annulé. Votre réservation ne compte plus : vous n'avez rien à faire.`,
    "Voir le planning",
    p.link,
    "Vous pouvez réserver une autre séance depuis votre espace.",
  );
  return { to, kind: "session_cancelled", subject: `Séance annulée : ${className}, ${when} — Matnexa`, link: p.link, ...body };
}

export function bookingPromotedEmail(to: string, p: BookingPromotion): MailMessage {
  const className = oneLine(p.className);
  const when = `${formatDay(p.startsAt, p.timeZone)} à ${formatTime(p.startsAt, p.timeZone)}`;
  const body = layout(
    "Votre place est confirmée",
    `Vous étiez sur la liste d'attente du cours « ${className} » du ${when}, au club « ${oneLine(p.academyName)} ». Une place vous a été attribuée : votre réservation est confirmée.`,
    "Voir mes séances",
    p.link,
    "Si vous ne pouvez plus venir, annulez votre réservation depuis votre espace pour libérer la place.",
  );
  return { to, kind: "booking_promoted", subject: `Place confirmée : ${className}, ${when} — Matnexa`, link: p.link, ...body };
}
