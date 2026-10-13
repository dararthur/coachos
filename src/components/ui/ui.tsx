import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses, type ButtonVariant } from "./button-classes";

export function LinkButton({ href, children, variant = "primary", className, download }: { href: string; children: ReactNode; variant?: ButtonVariant; className?: string; download?: boolean }) {
  // Téléchargement : <a> natif (une navigation client Next.js vers un fichier laisserait le routeur en attente).
  if (download) {
    return (
      <a href={href} download className={buttonClasses({ variant, className })}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClasses({ variant, className })}>
      {children}
    </Link>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function Card({ title, description, children, actions, className, as: Tag = "section" }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; as?: "section" | "div" }) {
  return (
    <Tag aria-labelledby={title ? `card-${slug(title)}` : undefined} className={`rounded-xl border border-line bg-surface p-5 shadow-sm ${className ?? ""}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 id={`card-${slug(title)}`} className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

const badgeTones = {
  neutral: "bg-slate-100 text-slate-800",
  success: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-900",
  brand: "bg-brand-100 text-brand-800",
} as const;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>;
}

export function Alert({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "success" | "warning" | "danger"; title?: string }) {
  const tones = {
    info: "border-sky-300 bg-sky-50 text-sky-950",
    success: "border-emerald-300 bg-emerald-50 text-emerald-950",
    warning: "border-amber-300 bg-amber-50 text-amber-950",
    danger: "border-red-300 bg-red-50 text-red-950",
  } as const;
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  // Structure valide d'une liste de définitions : <div><dt/><dd/></div>. Le lien étend sa zone cliquable à toute la carte.
  return (
    <div className="relative rounded-xl border border-line bg-surface p-4 shadow-sm">
      <dt className="text-sm text-muted">
        {href ? (
          <Link href={href} className="font-normal text-muted no-underline after:absolute after:inset-0 after:rounded-xl">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums text-ink">
        {value}
        {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

/** Tableau accessible : en-têtes de colonnes, légende masquée, défilement horizontal sur mobile. */
export function DataTable({ caption, headers, children }: { caption: string; headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">
        Page {page} sur {pages} · {total} résultat{total > 1 ? "s" : ""}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonClasses({ variant: "secondary" })} href={hrefFor(page - 1)}>
            Précédent
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={buttonClasses({ variant: "secondary" })} href={hrefFor(page + 1)}>
            Suivant
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (Array.isArray(searchParams[k]) ? searchParams[k]?.[0] : (searchParams[k] as string | undefined));
  if (one("created")) return <Alert tone="success">Création effectuée : {one("created")} élément(s).{one("skipped") ? ` ${one("skipped")} déjà existant(s) ignoré(s).` : ""}</Alert>;
  if (one("erased")) return <Alert tone="success">{one("erased") === "delete" ? "Membre supprimé définitivement." : "Membre anonymisé : ses présences sont conservées sous forme de statistiques non identifiantes."}</Alert>;
  if (one("deleted")) return <Alert tone="success">Élément supprimé.</Alert>;
  return null;
}
