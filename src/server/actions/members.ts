"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_IMPORT_BYTES, analyzeImport, planImport, type ImportRow, type RowIssue } from "@/domain/csv-import";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { personCreateSchema, personUpdateSchema, uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import * as members from "@/server/repositories/members";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

export async function createMemberAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("createMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.create");
    const input = parseForm(personCreateSchema, formData);
    let id: string;
    try {
      id = await inAcademy(ctx, (tx) =>
        members.createPerson(tx, academyId, {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          joinedOn: input.joinedOn ?? null,
        }),
      );
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", { email: "Un membre avec cet e-mail existe déjà." });
      throw e;
    }
    revalidatePath(`/a/${academyId}/members`);
    redirect(`/a/${academyId}/members/${id}?created=1`);
  });
}

export async function updateMemberAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.update");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(personUpdateSchema, formData);
    let ok: boolean;
    try {
      ok = await inAcademy(ctx, (tx) =>
        members.updatePerson(tx, academyId, id.data, {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          joinedOn: input.joinedOn ?? null,
        }),
      );
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", { email: "Un autre membre utilise déjà cet e-mail." });
      throw e;
    }
    if (!ok) throw new AppError("not_found");
    revalidatePath(`/a/${academyId}/members`);
    return { ok: true, data: null, message: "Fiche mise à jour." };
  });
}

export async function setMemberArchivedAction(academyId: string, personId: string, archive: boolean, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("archiveMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.update");
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const ok = await inAcademy(ctx, (tx) => members.setPersonArchived(tx, academyId, id.data, archive));
    if (!ok) throw new AppError("not_found");
    revalidatePath(`/a/${academyId}/members`);
    revalidatePath(`/a/${academyId}/members/${personId}`);
    return { ok: true, data: null, message: archive ? "Membre archivé." : "Membre restauré." };
  });
}

const eraseSchema = z.object({ mode: z.enum(["anonymize", "delete"], { error: "Choisissez un mode." }), confirm: z.literal("on", { error: "Confirmation requise." }) });

export async function eraseMemberAction(academyId: string, personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("eraseMember", async () => {
    const ctx = await authorizeAcademy(academyId, "members.erase");
    await enforceRateLimit("erase", ctx.user.id, LIMITS.erase.max, LIMITS.erase.window);
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    const input = parseForm(eraseSchema, formData);
    await inAcademy(ctx, (tx) => members.erasePerson(tx, id.data, input.mode));
    revalidatePath(`/a/${academyId}/members`);
    redirect(`/a/${academyId}/members?erased=${input.mode}`);
  });
}

// --- Import CSV ---------------------------------------------------------------------------------
export interface ImportReport {
  mode: "preview" | "commit";
  fatal: string | null;
  totalRows: number;
  valid: number;
  toCreate: number;
  created: number;
  ignoredColumns: string[];
  invalid: RowIssue[];
  duplicatesInFile: RowIssue[];
  skippedExisting: RowIssue[];
  possibleHomonyms: RowIssue[];
  sample: Pick<ImportRow, "line" | "firstName" | "lastName" | "email" | "joinedOn" | "externalRef">[];
}

const REPORT_LIST_LIMIT = 50;
const limited = (issues: RowIssue[]) => issues.slice(0, REPORT_LIST_LIMIT);

/**
 * Importe un CSV de membres. Deux étapes avec le même code : « preview » ne modifie rien ;
 * « commit » revalide TOUT côté serveur à partir du fichier (rien venant du navigateur n'est cru).
 */
export async function importMembersAction(academyId: string, _prev: ActionResult<ImportReport> | null, formData: FormData): Promise<ActionResult<ImportReport>> {
  return runAction("importMembers", async () => {
    const ctx = await authorizeAcademy(academyId, "members.import");
    await enforceRateLimit("import", ctx.user.id, LIMITS.importCsv.max, LIMITS.importCsv.window);
    const mode = formData.get("mode") === "commit" ? "commit" : "preview";

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return failure("validation", { file: "Choisissez un fichier CSV." });
    if (file.size > MAX_IMPORT_BYTES) return failure("payload_too_large", { file: "Fichier trop volumineux (1 Mo maximum)." });
    if (!/\.(csv|txt)$/i.test(file.name) && !["text/csv", "text/plain", "application/vnd.ms-excel", ""].includes(file.type)) {
      return failure("validation", { file: "Format non pris en charge : fournissez un fichier .csv." });
    }
    if (mode === "commit" && formData.get("adultConfirmed") !== "on") {
      return failure("validation", { adultConfirmed: "Vous devez attester que tous les membres importés sont majeurs." });
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      return failure("validation", { file: "Le fichier doit être encodé en UTF-8." });
    }
    const analysis = analyzeImport(text);
    const empty: ImportReport = {
      mode, fatal: analysis.fatal, totalRows: analysis.totalRows, valid: analysis.rows.length, toCreate: 0, created: 0,
      ignoredColumns: analysis.ignoredColumns, invalid: limited(analysis.invalid), duplicatesInFile: limited(analysis.duplicatesInFile),
      skippedExisting: [], possibleHomonyms: [], sample: [],
    };
    if (analysis.fatal) return { ok: true, data: empty };

    const report = await inAcademy(ctx, async (tx) => {
      const existing = await members.findExistingKeys(tx, academyId, analysis.rows);
      const plan = planImport(analysis.rows, existing);
      let created = 0;
      if (mode === "commit") {
        created = await members.insertImported(tx, academyId, plan.toCreate);
        await members.recordEvent(tx, academyId, "members.imported", {
          rows: analysis.totalRows, created, invalid: analysis.invalid.length, duplicates: analysis.duplicatesInFile.length + plan.skippedExisting.length,
        });
      }
      return { plan, created };
    });

    if (mode === "commit") revalidatePath(`/a/${academyId}/members`);
    return {
      ok: true,
      data: {
        ...empty,
        toCreate: report.plan.toCreate.length,
        created: report.created,
        skippedExisting: limited(report.plan.skippedExisting),
        possibleHomonyms: limited(report.plan.possibleHomonyms),
        sample: report.plan.toCreate.slice(0, 10),
      },
    };
  });
}
