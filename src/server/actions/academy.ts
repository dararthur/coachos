"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { academySettingsSchema, classTypeSchema, disciplineSchema, uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import * as academies from "@/server/repositories/academies";
import { parseForm } from "./helpers";

type FormState = ActionResult<unknown> | null;

export async function updateAcademyAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("updateAcademy", async () => {
    const ctx = await authorizeAcademy(academyId, "academy.update");
    const input = parseForm(academySettingsSchema, formData);
    const ok = await inAcademy(ctx, (tx) => academies.updateAcademy(tx, academyId, input));
    if (!ok) throw new AppError("forbidden");
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Paramètres enregistrés." };
  });
}

const deleteSchema = z.object({ confirm: z.string().min(1, "Saisissez le nom de l'académie.") });

export async function deleteAcademyAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("deleteAcademy", async () => {
    const ctx = await authorizeAcademy(academyId, "academy.delete");
    const input = parseForm(deleteSchema, formData);
    try {
      await inAcademy(ctx, (tx) => academies.deleteAcademy(tx, academyId, input.confirm));
    } catch (e) {
      if (e instanceof AppError && e.code === "confirmation_mismatch") return failure("confirmation_mismatch", { confirm: e.message });
      throw e;
    }
    redirect("/academies");
  });
}

export async function createDisciplineAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("createDiscipline", async () => {
    const ctx = await authorizeAcademy(academyId, "catalog.manage");
    const input = parseForm(disciplineSchema, formData);
    try {
      await inAcademy(ctx, (tx) => academies.createDiscipline(tx, academyId, input.name));
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", { name: "Cette discipline existe déjà." });
      throw e;
    }
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: "Discipline ajoutée." };
  });
}

const idSchema = z.object({ id: uuidField });

export async function toggleDisciplineArchivedAction(academyId: string, archive: boolean, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("archiveDiscipline", async () => {
    const ctx = await authorizeAcademy(academyId, "catalog.manage");
    const { id } = parseForm(idSchema, formData);
    const ok = await inAcademy(ctx, (tx) => academies.setDisciplineArchived(tx, academyId, id, archive));
    if (!ok) throw new AppError("not_found");
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: archive ? "Discipline archivée." : "Discipline restaurée." };
  });
}

export async function createClassTypeAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("createClassType", async () => {
    const ctx = await authorizeAcademy(academyId, "catalog.manage");
    const input = parseForm(classTypeSchema, formData);
    try {
      await inAcademy(ctx, (tx) =>
        academies.createClassType(tx, academyId, {
          disciplineId: input.disciplineId,
          name: input.name,
          durationMinutes: input.durationMinutes,
          capacity: input.capacity ?? null,
        }),
      );
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") return failure("duplicate", { name: "Ce type de cours existe déjà pour cette discipline." });
      throw e;
    }
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: "Type de cours ajouté." };
  });
}

export async function toggleClassTypeArchivedAction(academyId: string, archive: boolean, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("archiveClassType", async () => {
    const ctx = await authorizeAcademy(academyId, "catalog.manage");
    const { id } = parseForm(idSchema, formData);
    const ok = await inAcademy(ctx, (tx) => academies.setClassTypeArchived(tx, academyId, id, archive));
    if (!ok) throw new AppError("not_found");
    revalidatePath(`/a/${academyId}/settings`);
    return { ok: true, data: null, message: archive ? "Type de cours archivé." : "Type de cours restauré." };
  });
}
