/**
 * Numéros de téléphone : saisie libre, stockage E.164 (« +33612345678 »).
 * Les numéros nationaux à 10 chiffres commençant par 0 sont considérés comme français.
 */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Normalise une saisie (« 06 12 34 56 78 », « 0033 6… », « +33 (0)6… ») ; null si le numéro est invalide. */
export function normalizePhone(input: string): string | null {
  let v = input.trim().replace(/[\s.\-/]/g, "").replace("(0)", "").replace(/[()]/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  else if (/^0[1-9]\d{8}$/.test(v)) v = `+33${v.slice(1)}`;
  return E164.test(v) ? v : null;
}

/** Affichage lisible : « +33 6 12 34 56 78 » pour la France, E.164 tel quel sinon. */
export function formatPhone(e164: string): string {
  const fr = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return fr ? `+33 ${fr.slice(1).join(" ")}` : e164;
}

/** Lien WhatsApp (wa.me attend les chiffres sans « + »), avec un message prérempli facultatif. */
export function whatsappHref(e164: string, text?: string): string {
  const base = `https://wa.me/${e164.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
