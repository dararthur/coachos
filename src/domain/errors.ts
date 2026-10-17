/** Codes d'erreur métier stables, partagés par la base (messages `coachos:<code>`), le serveur et l'UI. */
export const ERROR_MESSAGES = {
  not_authenticated: "Vous n'êtes plus connecté (session expirée ou déconnexion) : reconnectez-vous pour continuer.",
  forbidden: "Vous n'avez pas les droits nécessaires pour cette action.",
  club_suspended: "Ce club est suspendu : écrivez à contact@matnexa.fr pour le rouvrir.",
  feature_disabled: "Cette fonctionnalité n'est pas incluse dans la formule de votre club.",
  not_found: "Élément introuvable.",
  validation: "Certaines informations sont invalides.",
  duplicate: "Cet élément existe déjà.",
  rate_limited: "Trop de tentatives. Réessayez dans quelques minutes.",
  academy_limit_reached: "Nombre maximal d'académies atteint pour ce compte.",
  invalid_timezone: "Fuseau horaire invalide.",
  invalid_instructor: "Le coach choisi n'appartient pas à cette académie.",
  invalid_role: "Rôle invalide.",
  invalid_email: "Adresse e-mail invalide.",
  invalid_person: "Membre invalide pour cette invitation.",
  invalid_mode: "Mode invalide.",
  invalid_action: "Action invalide.",
  invitation_limit_reached: "Trop d'invitations en attente. Révoquez-en avant d'en créer.",
  invitation_invalid: "Cette invitation est invalide, expirée ou destinée à un autre compte.",
  join_code_invalid: "Ce code de club est inconnu. Vérifiez-le auprès de votre coach.",
  academy_request_limit: "Trop de demandes en attente pour cette adresse.",
  catalog_in_use: "Des séances utilisent encore cet élément : archivez-le plutôt, ou supprimez d'abord ces séances.",
  email_not_confirmed: "Confirmez d'abord votre adresse e-mail.",
  last_owner: "Une académie doit conserver au moins un propriétaire.",
  sole_owner:
    "Vous êtes le seul propriétaire d'une académie : transférez la propriété ou supprimez l'académie avant de supprimer votre compte.",
  confirmation_mismatch: "Le nom saisi ne correspond pas.",
  session_cancelled: "Cette séance est annulée : les présences ne peuvent plus être enregistrées.",
  person_archived: "Ce membre est archivé : restaurez-le avant d'enregistrer une présence.",
  session_has_attendance: "Cette séance contient des présences : annulez-la plutôt que de la supprimer.",
  checkin_invalid: "Ce QR code n'est plus valide. Demandez au coach d'afficher le QR code actuel et scannez-le à nouveau.",
  checkin_no_profile: "Votre fiche n'est pas active dans ce club : contactez le coach.",
  adult_required: "Vous devez attester être majeur pour valider votre profil.",
  guardian_required: "Cette action est réservée au responsable légal du mineur.",
  minor_too_young: "Un compte propre n'est possible qu'à partir de 15 ans.",
  not_minor: "Cette personne est majeure : créez une fiche de membre majeur.",
  consent_required: "L'accord du responsable légal n'est pas encore confirmé.",
  merge_invalid: "Ces deux fiches ne peuvent pas être fusionnées : il faut une fiche sans compte et une fiche de membre majeur avec compte, toutes deux actives.",
  merge_has_history: "Ce compte a déjà des présences enregistrées : la fusion les effacerait. Contactez le support pour la faire à la main.",
  mail_failed: "Le message n'a pas pu être envoyé. Réessayez dans quelques minutes.",
  booking_no_profile: "Votre fiche n'est pas active dans ce club : contactez le coach.",
  booking_closed: "Cette séance est terminée : la réservation n'est plus possible.",
  pause_consent_required: "Le consentement explicite de la personne est requis pour noter une blessure ou une maladie.",
  pause_health_minor: "Pour un mineur, la blessure ou la maladie ne peut pas être notée : choisissez « Autre » ou « Ne souhaite pas s'exprimer ».",
  invalid_promotion: "Passage invalide : choisissez un grade différent du grade actuel, avec une date qui n'est pas dans le futur.",
  promotion_before_history: "Cette date est antérieure au dernier grade enregistré : pour l'historique, choisissez « Ancien grade » ; sinon corrigez la ligne existante.",
  past_grade_after_current: "Un ancien grade doit être daté avant le grade actuel. Pour un nouveau grade, choisissez « Nouveau grade actuel ».",
  grade_order: "Cette date changerait l'ordre des grades : un ancien grade doit rester antérieur au grade actuel. Corrigez plutôt la ligne du grade actuel.",
  invalid_pause: "Pause invalide : choisissez une raison et une date de reprise dans l'année à venir.",
  audience_not_allowed: "Ce cours n'est pas ouvert à cette personne (public ou âge minimum du cours).",
  booking_attended: "Votre présence est déjà enregistrée : la réservation ne peut plus être annulée.",
  checkin_no_booking: "Vous n'avez pas réservé cette séance.",
  checkin_waitlisted: "Vous êtes sur liste d'attente : le coach peut vous accorder une place.",
  checkin_closed: "Le pointage n'est pas ouvert pour cette séance.",
  checkin_too_early: "Le pointage ne peut pas encore être ouvert pour cette séance.",
  checkin_too_late: "Cette séance est terminée depuis trop longtemps pour ouvrir le pointage.",
  roll_validated: "La feuille d'appel est validée : rouvrez-la pour modifier le pointage.",
  roll_too_early: "Ce cours n'a pas encore commencé : la feuille d'appel pourra être validée dès son début.",
  attendance_too_early: "Ce cours a lieu un autre jour : l'appel sera possible le jour du cours.",
  photo_invalid: "Cette image n'est pas utilisable. Choisissez une autre photo.",
  payload_too_large: "Le fichier est trop volumineux.",
  network: "Pas de connexion : l'action n'a pas pu être confirmée. Vérifiez votre réseau (Wi-Fi ou données mobiles), puis réessayez.",
  internal: "Une erreur inattendue est survenue. Réessayez ; si le problème persiste, contactez le support.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ErrorCode, options?: { message?: string; fieldErrors?: Record<string, string>; cause?: unknown }) {
    super(options?.message ?? ERROR_MESSAGES[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}

/** Résultat uniforme des Server Actions : jamais de faux succès, jamais d'erreur brute vers l'UI. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: ErrorCode; fieldErrors?: Record<string, string> };

export function failure(code: ErrorCode, fieldErrors?: Record<string, string>, message?: string): ActionResult<never> {
  return { ok: false, code, error: message ?? ERROR_MESSAGES[code], fieldErrors };
}
