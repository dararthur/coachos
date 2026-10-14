/** Codes d'erreur métier stables, partagés par la base (messages `coachos:<code>`), le serveur et l'UI. */
export const ERROR_MESSAGES = {
  not_authenticated: "Vous devez être connecté pour continuer.",
  forbidden: "Vous n'avez pas les droits nécessaires pour cette action.",
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
  booking_no_profile: "Votre fiche n'est pas active dans ce club : contactez le coach.",
  booking_closed: "Cette séance est terminée : la réservation n'est plus possible.",
  booking_attended: "Votre présence est déjà enregistrée : la réservation ne peut plus être annulée.",
  checkin_no_booking: "Vous n'avez pas réservé cette séance.",
  checkin_waitlisted: "Vous êtes sur liste d'attente : le coach peut vous accorder une place.",
  checkin_closed: "Le pointage n'est pas ouvert pour cette séance.",
  checkin_too_early: "Le pointage ne peut pas encore être ouvert pour cette séance.",
  checkin_too_late: "Cette séance est terminée depuis trop longtemps pour ouvrir le pointage.",
  roll_validated: "La feuille d'appel est validée : rouvrez-la pour modifier le pointage.",
  photo_invalid: "Cette image n'est pas utilisable. Choisissez une autre photo.",
  payload_too_large: "Le fichier est trop volumineux.",
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
