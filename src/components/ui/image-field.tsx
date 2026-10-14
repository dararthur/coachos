"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/form";
import { buttonClasses } from "@/components/ui/button-classes";
import { InlineAction } from "@/components/ui/confirm";
import type { ActionResult } from "@/domain/errors";

const SIZE = 256;
const MAX_ORIGINAL = 1.9 * 1024 * 1024;
type Action = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown> | null>;

/** Réduit côté navigateur (une photo de téléphone fait plusieurs Mo) : recadrage carré (`cover`) ou proportions conservées (`inside`, transparence gardée) ; le serveur revérifie et ré-encode. */
async function shrink(file: File, fit: "cover" | "inside"): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  if (fit === "cover") {
    const side = Math.min(bitmap.width, bitmap.height);
    canvas.width = SIZE;
    canvas.height = SIZE;
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  } else {
    const k = Math.min(1, SIZE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) throw new Error("encode");
  return new File([blob], "photo.webp", { type: blob.type });
}

export function ImageField({
  upload,
  remove,
  hasImage,
  fit,
  addLabel,
  changeLabel,
  removeLabel,
  hint,
}: {
  upload: Action;
  remove: Action;
  hasImage: boolean;
  fit: "cover" | "inside";
  addLabel: string;
  changeLabel: string;
  removeLabel: string;
  hint: string;
}) {
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
      ready = await shrink(file, fit);
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
          <input id="image" name="photo" type="file" accept="image/*" className="peer sr-only" onChange={onPick} />
          <label htmlFor="image" className={`${buttonClasses({ variant: "secondary" })} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink`}>
            {hasImage ? changeLabel : addLabel}
          </label>
        </ActionForm>
        {hasImage && <InlineAction action={remove} label={removeLabel} pendingLabel="Retrait…" variant="quiet" />}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-ink-soft">{hint}</p>
    </div>
  );
}
