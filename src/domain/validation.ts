import { z } from "zod";
import { addDays, daysBetween, isValidTimeZone, parseCalendarDate } from "./dates";
import { isMinorBirthDate, todayIso } from "./minors";
import { normalizePhone } from "./phone";
import { DEPARTURE_VALUES, PAUSE_VALUES } from "./lifecycle";
import { AVATAR_STYLES, BELTS, MAX_STRIPES } from "./profile";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: Record<string, string> };

/** Valide une entrée non fiable ; retourne un message par champ (le premier rencontré). */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): ParseResult<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors };
}

/** FormData -> objet simple ; les clés répétées (cases à cocher multiples) deviennent des tableaux. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue; // métadonnées internes des Server Actions
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

// Lettres (toutes langues), marques, chiffres, espace, apostrophe, point, tiret. Refuse <, >, =, @, etc.
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} '’.-]*$/u;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const nameField = (label: string) =>
  z
    .string({ error: `${label} requis.` })
    .trim()
    .min(1, `${label} requis.`)
    .max(80, `${label} : 80 caractères maximum.`)
    .regex(NAME_PATTERN, `${label} : caractères non autorisés.`);

export const emailField = z
  .string({ error: "Adresse e-mail requise." })
  .trim()
  .toLowerCase()
  .max(254, "Adresse e-mail trop longue.")
  .pipe(z.email("Adresse e-mail invalide."));

export const phoneField = z
  .string()
  .max(30, "Numéro de téléphone trop long.")
  .transform((v, ctx) => {
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Numéro invalide. Exemple : 06 12 34 56 78 ou +32 470 12 34 56." });
      return z.NEVER;
    }
    return phone;
  });

export const passwordField = z
  .string({ error: "Mot de passe requis." })
  .min(12, "12 caractères minimum.")
  .max(72, "72 caractères maximum.");

export const uuidField = z.uuid("Identifiant invalide.");
export const dateField = z
  .string({ error: "Date requise." })
  .transform((v, ctx) => {
    const parsed = parseCalendarDate(v);
    if (!parsed) ctx.addIssue({ code: "custom", message: "Date invalide." });
    return parsed ?? "";
  });

const timeField = z.string({ error: "Heure requise." }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:MM).");
const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `${label} invalide.` })
    .int(`${label} invalide.`)
    .min(min, `${label} : minimum ${min}.`)
    .max(max, `${label} : maximum ${max}.`);

// --- Authentification ---------------------------------------------------------------------------
export const signupSchema = z
  .object({
    email: emailField,
    password: passwordField,
    displayName: optional(z.string().trim().max(100, "100 caractères maximum.").regex(/^[^<>\u0000-\u001f]*$/, "Caractères non autorisés.")),
    clubCode: optional(z.string().trim().max(20, "Code trop long.")),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, { path: ["password"], message: "Le mot de passe ne peut pas être l'adresse e-mail." });

export const loginSchema = z.object({
  email: emailField,
  password: z.string({ error: "Mot de passe requis." }).min(1, "Mot de passe requis.").max(200),
});
export const resetRequestSchema = z.object({ email: emailField });
const sameAsConfirm = { path: ["confirm"], message: "Les mots de passe ne correspondent pas." };
export const newPasswordSchema = z
  .object({ password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, sameAsConfirm);
/** Changement depuis le compte connecté : exige le mot de passe actuel. */
export const changePasswordSchema = z
  .object({ currentPassword: z.string({ error: "Mot de passe actuel requis." }).min(1, "Mot de passe actuel requis.").max(200), password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, sameAsConfirm);
/** Réinitialisation par lien e-mail : le jeton vient du lien, jamais de la session. */
export const resetPasswordSchema = z
  .object({ token: z.string({ error: "Lien invalide." }).min(10, "Lien invalide.").max(300, "Lien invalide."), password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, sameAsConfirm);

export const profileSchema = z.object({
  displayName: z.string().trim().max(100, "100 caractères maximum.").regex(/^[^<>\u0000-\u001f]*$/, "Caractères non autorisés."),
});

// --- Académie -----------------------------------------------------------------------------------
export const CURRENCIES = ["EUR", "CHF", "GBP", "USD", "CAD", "AUD"] as const;

export const academySchema = z.object({
  name: z.string({ error: "Nom requis." }).trim().min(2, "2 caractères minimum.").max(100, "100 caractères maximum.").refine((v) => !CONTROL_CHARS.test(v) && !/[<>]/.test(v), "Caractères non autorisés."),
  timezone: z.string().refine(isValidTimeZone, "Fuseau horaire invalide."),
  currency: z.enum(CURRENCIES, { error: "Devise non prise en charge." }),
});

export const checkinSettingsSchema = z.object({
  mode: z.enum(["rotating", "fixed"], { error: "Mode inconnu." }),
  beforeMinutes: intField("Avant le cours", 0, 240),
  afterMinutes: intField("Après le début", 0, 240),
});

export const academySettingsSchema = academySchema.extend({
  retentionMonths: intField("Durée", 6, 120),
  adultClassMinAge: intField("Âge minimum", 10, 18),
});

// --- Membres ------------------------------------------------------------------------------------
export const personFields = {
  firstName: nameField("Prénom"),
  lastName: nameField("Nom"),
  email: optional(emailField),
  phone: optional(phoneField),
  joinedOn: optional(dateField),
};

export const guardianFields = {
  guardianName: optional(nameField("Nom du responsable")),
  guardianEmail: optional(emailField),
  guardianPhone: optional(phoneField),
};

/**
 * Majeur : attestation obligatoire, horodatée par la base, aucune date de naissance conservée.
 * Mineur : date de naissance (effectivement mineure) et responsable légal (nom + e-mail) obligatoires ; l'e-mail et le
 * téléphone de l'enfant ne sont pas enregistrés (les messages vont au responsable).
 */
export const personCreateSchema = z
  .object({
    ...personFields,
    ageGroup: z.enum(["adult", "minor"], { error: "Indiquez si le membre est majeur ou mineur." }),
    adultConfirmed: optional(z.literal("on")),
    birthDate: optional(dateField),
    ...guardianFields,
  })
  .superRefine((v, ctx) => {
    if (v.ageGroup === "adult") {
      if (v.adultConfirmed !== "on") ctx.addIssue({ code: "custom", path: ["adultConfirmed"], message: "Vous devez attester que ce membre est majeur." });
      return;
    }
    if (!v.birthDate) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "Date de naissance requise pour un mineur." });
    else if (v.birthDate > todayIso()) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "Date de naissance dans le futur." });
    else if (!isMinorBirthDate(v.birthDate)) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "Cette personne a 18 ans ou plus : choisissez « Majeur »." });
    if (!v.guardianName) ctx.addIssue({ code: "custom", path: ["guardianName"], message: "Nom du responsable légal requis." });
    if (!v.guardianEmail) ctx.addIssue({ code: "custom", path: ["guardianEmail"], message: "E-mail du responsable légal requis." });
  });

export const guardianUpdateSchema = z.object({
  guardianName: nameField("Nom du responsable"),
  guardianEmail: emailField,
  guardianPhone: optional(phoneField),
});
export const personUpdateSchema = z.object({
  ...personFields,
  belt: optional(z.enum(BELTS, { error: "Ceinture inconnue." })),
  beltStripes: optional(intField("Barrettes", 0, MAX_STRIPES)),
});

// Profil du membre connecté : sa propre fiche. L'attestation n'est exigée (par la base) que la première fois.
export const myProfileSchema = z.object({
  firstName: nameField("Prénom"),
  lastName: nameField("Nom"),
  phone: optional(phoneField),
  belt: optional(z.enum(BELTS, { error: "Ceinture inconnue." })),
  beltStripes: optional(intField("Barrettes", 0, MAX_STRIPES)),
  avatarStyle: z.enum(AVATAR_STYLES, { error: "Choisissez une silhouette." }),
  adultConfirmed: optional(z.literal("on")),
});

// --- Catalogue ----------------------------------------------------------------------------------
const noControl = (v: string) => !/[\u0000--]/.test(v);

/** Publication du club. La visibilité (« public » pour le futur site du club) n'est pas encore proposée : toujours « members ». */
export const clubPostSchema = z.object({
  title: z.string({ error: "Titre requis." }).trim().min(1, "Titre requis.").max(120, "120 caractères maximum.").refine(noControl, "Caractères non autorisés."),
  body: z.string({ error: "Texte requis." }).trim().min(1, "Texte requis.").max(5000, "5 000 caractères maximum.").refine(noControl, "Caractères non autorisés."),
});

export const disciplineSchema = z.object({
  name: z.string({ error: "Nom requis." }).trim().min(2, "2 caractères minimum.").max(60, "60 caractères maximum.").refine((v) => !/[<>\u0000-\u001f]/.test(v), "Caractères non autorisés."),
});

export const classTypeSchema = z.object({
  disciplineId: uuidField,
  name: z.string({ error: "Nom requis." }).trim().min(2, "2 caractères minimum.").max(80, "80 caractères maximum.").refine((v) => !/[<>\u0000-\u001f]/.test(v), "Caractères non autorisés."),
  durationMinutes: intField("Durée", 15, 360),
  capacity: optional(intField("Capacité", 1, 500)),
  audience: z.enum(["all", "adults", "kids"], { error: "Public inconnu." }).default("all"),
});

/** Pause : raison d'une liste fermée, date de reprise ; la case de consentement est exigée par la base pour blessure et maladie. */
export const pauseSchema = z.object({
  reason: z.enum(PAUSE_VALUES, { error: "Choisissez une raison." }),
  until: dateField,
  consent: optional(z.literal("on")),
});

/** Passage de ceinture : nouveau grade (liste fermée) et date du passage ; la base refuse une date future et un grade inchangé. */
export const promotionSchema = z.object({
  belt: z.enum(BELTS, { error: "Choisissez une ceinture." }),
  stripes: intField("Barrettes", 0, MAX_STRIPES),
  on: dateField,
});

export const beltSinceSchema = z.object({ on: dateField });

export const archiveSchema = z.object({
  departureReason: optional(z.enum(DEPARTURE_VALUES, { error: "Motif inconnu." })),
});

export const classTypeAudienceSchema = z.object({
  id: uuidField,
  audience: z.enum(["all", "adults", "kids"], { error: "Public inconnu." }),
});

// --- Séances ------------------------------------------------------------------------------------
/** Une séance par jour sur une année complète (les créneaux d'une même récurrence sont à des jours distincts). */
export const MAX_OCCURRENCES = 366;
/** Une récurrence s'arrête au plus tard le 31 décembre de l'année de sa première séance (AAAA-MM-JJ). */
export const recurrenceLimit = (firstDate: string): string => `${firstDate.slice(0, 4)}-12-31`;

export const sessionCreateSchema = z
  .object({
    classTypeId: uuidField,
    instructorId: optional(uuidField),
    date: dateField,
    time: timeField,
    durationMinutes: intField("Durée", 15, 360),
    capacity: optional(intField("Capacité", 1, 500)),
    notes: optional(z.string().trim().max(500, "500 caractères maximum.").refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "Caractères non autorisés.")),
    repeat: z.enum(["none", "weekly"]).default("none"),
    weekdays: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().min(1).max(7)).max(7)),
    until: optional(dateField),
  })
  .superRefine((v, ctx) => {
    if (v.repeat !== "weekly") return;
    if (v.weekdays.length === 0) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Choisissez au moins un jour." });
    if (!v.until) {
      ctx.addIssue({ code: "custom", path: ["until"], message: "Date de fin requise pour une récurrence." });
      return;
    }
    if (v.until < v.date) ctx.addIssue({ code: "custom", path: ["until"], message: "La fin doit suivre le début." });
    else if (v.until > recurrenceLimit(v.date))
      ctx.addIssue({ code: "custom", path: ["until"], message: `La répétition s'arrête au plus tard le 31 décembre ${v.date.slice(0, 4)} (fin de l'année de la première séance).` });
  });

export const sessionUpdateSchema = z.object({
  instructorId: optional(uuidField),
  date: dateField,
  time: timeField,
  durationMinutes: intField("Durée", 15, 360),
  capacity: optional(intField("Capacité", 1, 500)),
  notes: optional(z.string().trim().max(500, "500 caractères maximum.")),
});

// --- Présences ----------------------------------------------------------------------------------
export const ATTENDANCE_STATUSES = ["present", "late", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "Présent",
  late: "En retard",
  absent: "Absent",
};

export const attendanceSchema = z.object({
  sessionId: uuidField,
  personId: uuidField,
  // « none » efface l'enregistrement (retour à « non renseigné »).
  status: z.enum(["present", "late", "absent", "none"]),
});

// --- Équipe -------------------------------------------------------------------------------------
export const invitationSchema = z.object({
  email: emailField,
  role: z.enum(["admin", "coach", "member"], { error: "Rôle invalide." }),
  personId: optional(uuidField),
});

// --- Rapports -----------------------------------------------------------------------------------
export const MAX_REPORT_DAYS = 366;

export const reportFilterSchema = z
  .object({
    from: dateField,
    to: dateField,
    classTypeId: optional(uuidField),
    personId: optional(uuidField),
  })
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: "custom", path: ["to"], message: "La fin doit suivre le début." });
    else if (daysBetween(v.from, v.to) > MAX_REPORT_DAYS) ctx.addIssue({ code: "custom", path: ["to"], message: "Période limitée à 12 mois." });
  });

export function defaultReportRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}

/** Demande de création de club (formulaire public, sans compte) : approuvée à la main par l'administrateur de la plateforme. */
export const clubRequestSchema = academySchema.extend({
  contactName: nameField("Votre nom"),
  email: emailField,
  note: optional(z.string().trim().max(500, "500 caractères maximum.").regex(/^[^\u0000-\u0008\u000b-\u001f\u007f<>]*$/, "Caractères non autorisés.")),
});

/** Création effective du club une fois la demande approuvée : le demandeur peut corriger le nom, le fuseau et la devise. */
export const claimClubSchema = academySchema.extend({ requestId: uuidField });
