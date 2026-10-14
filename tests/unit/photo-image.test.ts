import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeLogoImage, normalizeSquareImage } from "../../src/server/image";

const base = () => sharp({ create: { width: 1600, height: 900, channels: 3, background: "#1d4e89" } });

describe("normalisation des photos", () => {
  it.each(["jpeg", "png", "webp", "gif", "tiff", "avif"] as const)("accepte le format %s et le ramène à un carré WebP de 256 px", async (fmt) => {
    const input = await base()[fmt]().toBuffer();
    const out = await normalizeSquareImage(input);
    expect(out.contentType).toBe("image/webp");
    const meta = await sharp(out.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
    expect(out.data.length).toBeLessThan(20_000);
  });

  it("supprime les métadonnées (GPS compris)", async () => {
    const input = await base().withExif({ IFD0: { Copyright: "secret" } }).jpeg().toBuffer();
    const meta = await sharp((await normalizeSquareImage(input)).data).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("refuse le SVG, le texte et les fichiers vides", async () => {
    await expect(normalizeSquareImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'))).rejects.toMatchObject({ code: "photo_invalid" });
    await expect(normalizeSquareImage(Buffer.from("pas une image"))).rejects.toMatchObject({ code: "photo_invalid" });
    await expect(normalizeSquareImage(Buffer.alloc(0))).rejects.toMatchObject({ code: "photo_invalid" });
  });
});

describe("normalisation du logo", () => {
  it("conserve les proportions et la transparence, sans agrandir", async () => {
    const wide = await sharp({ create: { width: 800, height: 200, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } }).png().toBuffer();
    const meta = await sharp((await normalizeLogoImage(wide)).data).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([256, 64, true]);
    const tiny = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#123456" } }).png().toBuffer();
    const small = await sharp((await normalizeLogoImage(tiny)).data).metadata();
    expect([small.width, small.height]).toEqual([40, 20]);
  });
});
