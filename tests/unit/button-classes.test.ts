import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonClasses, classGroup, mergeClasses, type ButtonVariant } from "@/components/ui/button-classes";

const variants: ButtonVariant[] = ["primary", "secondary", "danger", "ghost", "quiet"];
const list = (s: string) => s.split(" ");
const utility = (cls: string) => cls.slice(cls.lastIndexOf(":") + 1).replace(/^-/, "");

describe("buttonClasses", () => {
  it("chaque classe de base et de variante appartient à un groupe connu (sinon elle ne serait jamais remplaçable)", () => {
    for (const variant of variants) {
      for (const cls of list(buttonClasses({ variant }))) {
        expect(classGroup(utility(cls)), `${variant}: ${cls}`).not.toBeNull();
      }
    }
  });

  it("seule la variante discrète retire une classe de base : no-underline (underline l'emportait déjà dans la feuille)", () => {
    const base = list(buttonClasses({ variant: "ghost" })).filter((c) => !["text-ink", "hover:bg-sunken", "active:bg-sunken"].includes(c));
    for (const variant of variants) {
      const classes = list(buttonClasses({ variant }));
      expect(base.filter((c) => !classes.includes(c)), variant).toEqual(variant === "quiet" ? ["no-underline"] : []);
    }
  });

  it("le padding de l'appelant remplace celui de la base, par préfixe de variante", () => {
    const classes = list(buttonClasses({ variant: "ghost", className: "px-2 sm:px-3" }));
    expect(classes).not.toContain("px-4");
    expect(classes).toContain("py-2");
    expect(classes.slice(-2)).toEqual(["px-2", "sm:px-3"]);
  });

  it("un raccourci couvre ses côtés, un côté seul ne retire pas le raccourci", () => {
    expect(list(buttonClasses({ className: "p-0" }))).not.toEqual(expect.arrayContaining(["px-4"]));
    expect(list(buttonClasses({ className: "p-0" }))).not.toContain("py-2");
    expect(list(buttonClasses({ className: "py-3" }))).toContain("px-4");
    expect(list(buttonClasses({ className: "pl-1" }))).toContain("px-4");
    expect(mergeClasses("pl-2 pr-2", "px-3")).toBe("px-3");
  });

  it("largeur, justification et graisse sont remplaçables ; les autres groupes restent", () => {
    expect(list(buttonClasses({ className: "justify-start" }))).not.toContain("justify-center");
    expect(list(buttonClasses({ className: "font-bold" }))).not.toContain("font-semibold");
    expect(list(buttonClasses({ className: "rounded-none" }))).not.toContain("rounded-sm");
    expect(list(buttonClasses({ className: "rounded-t-lg" }))).toContain("rounded-sm");
    // text-lg (taille) ne retire pas text-white (couleur), et inversement.
    const sized = list(buttonClasses({ className: "text-lg" }));
    expect(sized).toContain("text-white");
    expect(sized).not.toContain("text-sm");
    const colored = list(buttonClasses({ className: "text-ink" }));
    expect(colored).toContain("text-sm");
    expect(colored).not.toContain("text-white");
  });

  it("une classe préfixée ne retire que la classe de même préfixe", () => {
    const classes = list(buttonClasses({ className: "disabled:opacity-40 hover:bg-accent" }));
    expect(classes).not.toContain("disabled:opacity-55");
    expect(classes).toContain("bg-accent");
    expect(classes).not.toContain("hover:bg-accent-strong");
    expect(classes).toContain("active:bg-accent-strong");
  });

  it("le marquage important et les valeurs arbitraires sont reconnus", () => {
    expect(list(buttonClasses({ className: "px-2!" }))).not.toContain("px-4");
    expect(list(buttonClasses({ className: "px-[13px]" }))).not.toContain("px-4");
    expect(list(buttonClasses({ className: "md:px-[calc(1rem+2px)]" }))).toContain("px-4");
  });

  it("les classes inconnues ou sans conflit s'ajoutent sans rien retirer", () => {
    const plain = list(buttonClasses({ variant: "secondary" }));
    for (const extra of ["w-full", "sm:w-auto", "shrink-0", "-ml-3", "my-custom-hook"]) {
      expect(list(buttonClasses({ variant: "secondary", className: extra }))).toEqual([...plain, extra]);
    }
  });

  it("rendu inchangé des appels existants (hors classes ajoutées en fin)", () => {
    expect(buttonClasses({ variant: "quiet", className: "-ml-3" })).toBe(`${buttonClasses({ variant: "quiet" })} -ml-3`);
    expect(buttonClasses({ className: "w-full sm:w-auto" })).toBe(`${buttonClasses()} w-full sm:w-auto`);
    expect(list(buttonClasses({ variant: "quiet" }))).toContain("px-4");
  });
});

describe("appels de buttonClasses / LinkButton / SubmitButton / ConfirmAction", () => {
  const srcDir = path.resolve(import.meta.dirname, "../../src");
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(path.join(srcDir, f), "utf8") }));
  const overrides = files.flatMap(({ file, text }) =>
    [
      ...text.matchAll(/buttonClasses\(\{[^}]*className:\s*"([^"]*)"/g),
      ...text.matchAll(/<(?:LinkButton|SubmitButton)\b[^>]*?\sclassName="([^"]*)"/g),
      ...text.matchAll(/triggerClassName="([^"]*)"/g),
    ].map((m) => ({ file, className: m[1] })),
  );

  it("trouve bien des appels à vérifier", () => {
    expect(overrides.length).toBeGreaterThan(5);
  });

  it("n'utilisent plus `!` pour forcer une classe : la fusion s'en charge", () => {
    for (const { file, className } of overrides) {
      expect(className, file).not.toMatch(/(^|\s)!|!(\s|$)/);
    }
  });
});
