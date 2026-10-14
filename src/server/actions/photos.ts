"use server";

import { revalidatePath } from "next/cache";
import { AppError, failure, type ActionResult } from "@/domain/errors";
import { uuidField } from "@/domain/validation";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import { MAX_IMAGE_UPLOAD_BYTES, normalizeLogoImage, normalizeSquareImage } from "@/server/image";
import * as photos from "@/server/repositories/photos";

type FormState = ActionResult<unknown> | null;

/** Le membre envoie SA photo : normalisée côté serveur (carré 256 px, WebP, sans métadonnées) avant d'être stockée. */
export async function setMyPhotoAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("setMyPhoto", async () => {
    const ctx = await authorizeAcademy(academyId);
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) return failure("photo_invalid", { photo: "Choisissez une image." });
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) return failure("payload_too_large", { photo: "Image trop volumineuse (2 Mo maximum)." });
    const { contentType, data } = await normalizeSquareImage(Buffer.from(await file.arrayBuffer()));
    await inAcademy(ctx, (tx) => photos.setMyPhoto(tx, academyId, contentType, data));
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Photo enregistrée." };
  });
}

/** Retire la photo d'une fiche : le membre la sienne, un administrateur celle de n'importe quel membre. */
export async function removePhotoAction(academyId: string, personId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("removePhoto", async () => {
    const ctx = await authorizeAcademy(academyId);
    const id = uuidField.safeParse(personId);
    if (!id.success) throw new AppError("not_found");
    await inAcademy(ctx, (tx) => photos.removePhoto(tx, academyId, id.data));
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Photo retirée." };
  });
}

/** Logo du club (administrateurs) : normalisé côté serveur (256 px maximum, WebP, proportions et transparence conservées). */
export async function setAcademyLogoAction(academyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runAction("setAcademyLogo", async () => {
    const ctx = await authorizeAcademy(academyId, "academy.update");
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) return failure("photo_invalid", { photo: "Choisissez une image." });
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) return failure("payload_too_large", { photo: "Image trop volumineuse (2 Mo maximum)." });
    const { contentType, data } = await normalizeLogoImage(Buffer.from(await file.arrayBuffer()));
    await inAcademy(ctx, (tx) => photos.setAcademyLogo(tx, academyId, contentType, data));
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Logo enregistré." };
  });
}

export async function removeAcademyLogoAction(academyId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  return runAction("removeAcademyLogo", async () => {
    const ctx = await authorizeAcademy(academyId, "academy.update");
    await inAcademy(ctx, (tx) => photos.removeAcademyLogo(tx, academyId));
    revalidatePath(`/a/${academyId}`, "layout");
    return { ok: true, data: null, message: "Logo retiré." };
  });
}
