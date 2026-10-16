import Link from "next/link";
import type { ReactNode } from "react";
import { MatnexaLogo } from "@/components/brand/logo";

const WIDTHS = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-2xl", xl: "max-w-3xl", wide: "max-w-6xl" } as const;

/** Cadre des pages hors club (mes clubs, compte, création de club, pointage, invitation, confidentialité). */
export function StandaloneFrame({ children, width = "lg", aside }: { children: ReactNode; width?: keyof typeof WIDTHS; aside?: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-1.5 ${WIDTHS[width]}`}>
          <Link href="/" className="inline-flex min-h-11 items-center no-underline">
            <MatnexaLogo size="sm" />
          </Link>
          {aside}
        </div>
      </header>
      <main id="contenu" className={`mx-auto w-full px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6 sm:pt-10 ${WIDTHS[width]}`}>
        {children}
      </main>
    </div>
  );
}
