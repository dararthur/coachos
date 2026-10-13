import "server-only";
import { AppError } from "@/domain/errors";

/**
 * Journalisation structurée et redactée. Règles :
 *  - jamais de mot de passe, jeton, cookie, e-mail ni nom dans les logs ;
 *  - jamais le texte SQL ni ses paramètres (les erreurs `postgres` les embarquent : on n'en extrait que le code).
 */
const SENSITIVE_KEY = /pass|token|secret|cookie|authorization|email|name|key|jwt|phone|apikey/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[tronqué]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  if (typeof value === "string" && value.length > 200) return value.slice(0, 200) + "…";
  return value;
}

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    const cause = error.cause as { code?: string; constraint_name?: string } | undefined;
    return { type: "AppError", code: error.code, pg: cause?.code, constraint: cause?.constraint_name };
  }
  const e = error as { name?: string; code?: string; routine?: string; constraint_name?: string; message?: string };
  return { type: e?.name ?? "Error", pg: e?.code, routine: e?.routine, constraint: e?.constraint_name, message: e?.code ? undefined : e?.message?.slice(0, 200) };
}

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(fields ? (redact(fields) as object) : {}) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, error: unknown, fields?: Record<string, unknown>) => emit("error", event, { ...fields, error: describeError(error) }),
};
