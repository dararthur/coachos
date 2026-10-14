import "server-only";
import sharp from "sharp";
import { AppError } from "@/domain/errors";

/** Taille maximale acceptée avant traitement (le client réduit déjà l'image ; ceci borne un envoi direct). */
export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

// Tout format raster courant est accepté (téléphones compris : HEIF/AVIF) ; SVG, PDF et autres formats vectoriels ou documents sont refusés.
const ACCEPTED = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

/**
 * Normalise une image envoyée par l'utilisateur : formats raster vérifiés sur le contenu (pas sur le nom ni le type annoncé ; première image d'une animation),
 * orientation EXIF appliquée, recadrage carré, réduction à `size` px, ré-encodage WebP sans aucune métadonnée (GPS compris).
 */
export async function normalizeSquareImage(input: Buffer, size = 256): Promise<{ contentType: "image/webp"; data: Buffer }> {
  if (input.length === 0 || input.length > MAX_IMAGE_UPLOAD_BYTES) throw new AppError("photo_invalid");
  try {
    const img = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" });
    const meta = await img.metadata();
    if (!meta.format || !ACCEPTED.has(meta.format)) throw new AppError("photo_invalid");
    const data = await img.rotate().resize(size, size, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer();
    return { contentType: "image/webp", data };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("photo_invalid", { cause: e });
  }
}
