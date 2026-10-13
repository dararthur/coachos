import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <p className="mb-6 text-center text-sm font-semibold uppercase tracking-widest text-brand-700">Coach OS</p>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-center text-xs text-muted">
        <Link href="/privacy">Confidentialité et données personnelles</Link>
      </p>
    </main>
  );
}
