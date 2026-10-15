import { chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import QRCode from "qrcode";
import { completeProfile, createClub, expect, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * Chaîne COMPLÈTE dans un vrai navigateur : la « caméra » de Chrome diffuse une vidéo contenant un vrai QR de pointage
 * (fichier Y4M généré ici), le scanner l'ouvre depuis l'onglet « Pointer » (navigation interne), jsQR le décode, le
 * serveur valide la clé, l'adhérent confirme et la présence est écrite en base. Seule la caméra physique est simulée.
 */

/** Vidéo Y4M (4:2:0) 640×480 : QR noir sur fond blanc, centré, quelques images (Chrome boucle sur le fichier). */
function qrVideo(text: string, file: string) {
  const W = 640;
  const H = 480;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const scale = Math.floor(400 / n);
  const ox = Math.floor((W - n * scale) / 2);
  const oy = Math.floor((H - n * scale) / 2);
  const y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c))
        for (let dy = 0; dy < scale; dy++) y.fill(16, (oy + r * scale + dy) * W + ox + c * scale, (oy + r * scale + dy) * W + ox + (c + 1) * scale);
  const chroma = Buffer.alloc((W * H) / 4, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
}

test("QR réel filmé par la caméra simulée : décodage, validation serveur, présence enregistrée en base", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueEmail("cam-qr"), "Cam QR");
  const club = await createClub(page, "Club Cam QR");
  await page.getByRole("button", { name: "Mode membre" }).click();
  await completeProfile(page, club);

  const { adminUrl } = JSON.parse(readFileSync(path.join(os.tmpdir(), `coachos-e2e-db-${process.env.E2E_PORT ?? 3100}.json`), "utf8")) as { adminUrl: string };
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const dir = mkdtempSync(path.join(os.tmpdir(), "coachos-qr-video-"));
  try {
    await sql`update public.academies set checkin_mode = 'fixed' where id = ${club}`;
    const [{ key }] = [...(await sql<{ key: string }[]>`select key from public.academy_checkin_keys where academy_id = ${club}`)] as [{ key: string }];
    const [ct] = await sql<{ id: string }[]>`select id from public.class_types where academy_id = ${club} order by created_at limit 1`;
    await sql`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at) values (${club}, ${ct!.id}, now() + interval '10 minutes', now() + interval '100 minutes')`;

    const video = path.join(dir, "qr.y4m");
    qrVideo(`${baseURL}/checkin/club/${key}`, video);
    const camBrowser = await chromium.launch({
      channel: process.env.PW_CHANNEL || undefined,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
    });
    try {
      const context = await camBrowser.newContext({
        baseURL,
        storageState: await page.context().storageState(),
        permissions: ["camera"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
        extraHTTPHeaders: { "x-real-ip": randomIp() },
      });
      const phone = await context.newPage();
      await phone.goto(`/a/${club}/me`);
      await phone.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Pointer ma présence" }).tap();
      await expect(phone).toHaveURL(new RegExp(`/checkin/club/${key}$`), { timeout: 20_000 }); // décodé dans le flux vidéo
      expect(await phone.evaluate(() => document.querySelector("video")?.srcObject ?? null)).toBeNull(); // caméra coupée
      await phone.getByRole("button", { name: "Réserver et confirmer ma présence" }).tap();
      await expect(phone.getByRole("heading", { name: "Présence enregistrée" })).toBeVisible();
      await context.close();
    } finally {
      await camBrowser.close();
    }
    const rows = await sql<{ status: string; source: string }[]>`select a.status, a.source from public.attendance a join public.people p on p.id = a.person_id
      where a.academy_id = ${club} and p.user_id is not null`;
    expect(rows).toEqual([{ status: "present", source: "qr" }]);
  } finally {
    await sql.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
