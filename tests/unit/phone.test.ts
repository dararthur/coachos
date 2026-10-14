import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, whatsappHref } from "@/domain/phone";
import { personUpdateSchema } from "@/domain/validation";

describe("téléphone", () => {
  it("normalise les saisies courantes en E.164", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("06.12.34.56.78")).toBe("+33612345678");
    expect(normalizePhone("+33 (0)6 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("0033612345678")).toBe("+33612345678");
    expect(normalizePhone("+32 470 12 34 56")).toBe("+32470123456");
  });

  it("refuse ce qui n'est pas un numéro", () => {
    for (const bad of ["", "12", "06 12 34", "abc", "+0612345678", "javascript:alert(1)", "+33 6 12 34 56 78 99 99 99"]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });

  it("formate pour l'affichage et construit le lien WhatsApp", () => {
    expect(formatPhone("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(formatPhone("+32470123456")).toBe("+32470123456");
    expect(whatsappHref("+33612345678")).toBe("https://wa.me/33612345678");
    expect(whatsappHref("+33612345678", "Salut Léa, ça va ?")).toBe("https://wa.me/33612345678?text=Salut%20L%C3%A9a%2C%20%C3%A7a%20va%20%3F");
  });

  it("champ facultatif de la fiche membre : vide accepté, invalide signalé", () => {
    expect(personUpdateSchema.safeParse({ firstName: "Léa", lastName: "D", phone: "" }).data?.phone).toBeUndefined();
    expect(personUpdateSchema.safeParse({ firstName: "Léa", lastName: "D", phone: "06 12 34 56 78" }).data?.phone).toBe("+33612345678");
    expect(personUpdateSchema.safeParse({ firstName: "Léa", lastName: "D", phone: "12" }).success).toBe(false);
  });
});
