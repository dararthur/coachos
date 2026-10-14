import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { clubCheckinPath } from "@/domain/checkin";
import { MatnexaLogo } from "@/components/brand/logo";
import { AcademyLogo } from "@/components/ui/academy-logo";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { env } from "@/server/env";
import { getCheckinSettings } from "@/server/repositories/checkin";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Affiche du QR de pointage", robots: { index: false } };

/** Affiche A4 à imprimer : le QR fixe du club, le nom du club et la consigne. L'écran propose de l'imprimer, le papier n'a que l'affiche. */
export default async function PosterPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId, "academy.update");
  const settings = await inAcademy(ctx, (tx) => getCheckinSettings(tx, academyId));
  if (settings.mode !== "fixed" || !settings.key) notFound();
  // Avec un logo au centre (≈ 6 % de la surface), la correction d'erreur maximale garde le code lisible.
  const hasLogo = ctx.academy.logoVersion !== null;
  const url = `${env().SITE_URL}${clubCheckinPath(settings.key)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: hasLogo ? "H" : "Q", margin: 1, color: { dark: "#16191d", light: "#ffffff" } });
  const qr = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/a/${academyId}/settings#pointage`} className="inline-flex min-h-11 items-center underline underline-offset-[3px]">
          ← Paramètres
        </Link>
        <PrintButton />
      </div>
      <section className="flex flex-col items-center gap-8 rounded-sm border border-line bg-surface px-8 py-12 text-center print:border-0 print:py-8">
        <div className="flex items-center gap-4">
          <AcademyLogo academy={ctx.academy} size={72} />
          <h1 className="text-[2.25rem] font-bold leading-tight font-stretch-[80%] tracking-[-0.01em]">{ctx.academy.name}</h1>
        </div>
        <div className="relative size-[min(420px,80vw)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR vectoriel en data URI. */}
          <img src={qr} alt={`QR code de pointage du club ${ctx.academy.name}`} width={420} height={420} className="size-full" />
          {hasLogo && (
            <span className="absolute left-1/2 top-1/2 flex size-[22%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm bg-white p-[2%]">
              <AcademyLogo academy={ctx.academy} size={92} className="size-full" />
            </span>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-[1.75rem] font-bold font-stretch-[80%]">Scannez pour pointer votre présence</p>
          <p className="text-lg text-ink-soft">Ouvrez Matnexa, touchez « Pointer ma présence », puis visez ce code. Pensez à réserver votre cours.</p>
        </div>
        <MatnexaLogo size="sm" />
      </section>
      <div className="mt-6 print:hidden">
        <label htmlFor="qr-link" className="text-sm font-semibold">
          Adresse encodée dans le QR
        </label>
        <input id="qr-link" readOnly value={url} className="mt-1 block w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-xs" />
        <p className="mt-1 text-xs text-ink-soft">À titre d&apos;information : elle ne fonctionne que pour les adhérents connectés de votre club.</p>
      </div>
    </main>
  );
}
