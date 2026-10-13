import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { apiErrorInfo } from "@/server/auth/api-error";

describe("lecture des erreurs de Better Auth par leur forme (indépendante de l'identité de classe)", () => {
  it("reconnaît la vraie APIError : statut et code", () => {
    expect(apiErrorInfo(new APIError("FORBIDDEN", { message: "x", code: "EMAIL_NOT_VERIFIED" }))).toEqual({ status: 403, code: "EMAIL_NOT_VERIFIED" });
    expect(apiErrorInfo(new APIError("TOO_MANY_REQUESTS", { message: "x" }))).toEqual({ status: 429, code: undefined });
    expect(apiErrorInfo(new APIError("UNAUTHORIZED", { message: "x", code: "INVALID_EMAIL_OR_PASSWORD" }))?.status).toBe(401);
  });

  it("reconnaît AUSSI une copie du paquet : classe distincte, même forme (le cas qui cassait `instanceof`)", () => {
    class OtherCopyOfAPIError extends Error {
      statusCode = 401;
      body = { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" };
      constructor() {
        super("Invalid email or password");
        this.name = "APIError";
      }
    }
    const copy = new OtherCopyOfAPIError();
    expect(copy instanceof APIError).toBe(false); // la régression : instanceof est faux
    expect(apiErrorInfo(copy)).toEqual({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
  });

  it("ignore tout ce qui n'est pas une erreur d'API : erreurs ordinaires, base de données, valeurs nues", () => {
    for (const other of [new Error("boom"), Object.assign(new Error("pg"), { code: "42501" }), { name: "APIError" }, { statusCode: 401 }, null, undefined, "APIError", 401]) {
      expect(apiErrorInfo(other), String(other)).toBeNull();
    }
  });
});
