import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { AppError } from "@/domain/errors";
import { formToObject, parseWith } from "@/domain/validation";

/** Valide un FormData ; lève AppError("validation") avec un message par champ. */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): z.output<S> {
  const result = parseWith(schema, formToObject(formData));
  if (!result.ok) throw new AppError("validation", { fieldErrors: result.fieldErrors });
  return result.data;
}

/** Redirection interne uniquement : refuse les URL absolues, protocol-relative et les chemins exotiques. */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 300) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

export function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
