"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/form";
import { buttonClasses } from "@/components/ui/button-classes";
import { InlineAction } from "@/components/ui/confirm";
import type { ActionResult } from "@/domain/errors";

const SIZE = 256;
const MAX_ORIGINAL = 1.9 * 1024 * 1024;
type Action = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown> | null>;

/** Recadre en carré et réduit côté navigateur (une photo de téléphone fait plusieurs Mo) ; le serveur revérifie et ré-encode. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) throw new Error("encode");
  return new File([blob], "photo.webp", { type: blob.type });
}

export function PhotoField({ upload, remove, hasPhoto }: { upload: Action; remove: Action; hasPhoto: boolean }) {
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const form = input.form;
    const file = input.files?.[0];
    if (!file || !form) return;
    setError(null);
    // Le navigateur réduit en priorité ; s'il ne sait pas lire ce format, on envoie l'original si assez léger (le serveur sait en lire davantage).
    let ready: File | null = null;
    try {
      ready = await shrink(file);
    } catch {
      if (file.size <= MAX_ORIGINAL) ready = file;
    }
    if (!ready) {
      input.value = "";
      setError("Cette image est trop lourde et ce navigateur ne sait pas la réduire. Essayez une autre photo.");
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(ready);
    input.files = dt.files;
    form.requestSubmit();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <ActionForm action={upload}>
          <input id="photo" name="photo" type="file" accept="image/*" className="peer sr-only" onChange={onPick} />
          <label htmlFor="photo" className={`${buttonClasses({ variant: "secondary" })} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink`}>
            {hasPhoto ? "Changer la photo" : "Ajouter une photo"}
          </label>
        </ActionForm>
        {hasPhoto && <InlineAction action={remove} label="Retirer la photo" pendingLabel="Retrait…" variant="quiet" />}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-ink-soft">Facultatif. Tout format d&apos;image : la photo est recadrée en carré et allégée automatiquement.</p>
    </div>
  );
}
