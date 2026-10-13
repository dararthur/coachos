import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-sm font-semibold uppercase tracking-widest text-brand-700">Coach OS</p>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-center text-xs text-muted">
        <Link href="/privacy">Confidentialité et données personnelles</Link>
      </p>
    </main>
  );
}
