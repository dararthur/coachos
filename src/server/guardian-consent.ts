import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getMailer } from "@/server/mail";
import { guardianConsentEmail } from "@/server/mail/templates";
import { hashToken } from "@/server/actions/helpers";

/** Jeton à usage de lien : 256 bits aléatoires ; seule son empreinte SHA-256 est stockée en base. */
export function newConsentToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export interface PendingConsent {
  token: string;
  guardianEmail: string;
  childFirstName: string;
  academyName: string;
}

/**
 * Envoie le lien d'accord au responsable légal. Retourne false en cas d'échec du fournisseur (journalisé sans le destinataire) :
 * l'appelant l'indique au staff, qui peut renvoyer le lien depuis la fiche.
 */
export async function sendGuardianConsent(c: PendingConsent): Promise<boolean> {
  try {
    const link = new URL(`/consent/${c.token}`, env().SITE_URL).toString();
    await getMailer().send(guardianConsentEmail(c.guardianEmail, link, { childFirstName: c.childFirstName, academyName: c.academyName }));
    return true;
  } catch (error) {
    logger.error("mail.guardian_consent_failed", error);
    return false;
  }
}
