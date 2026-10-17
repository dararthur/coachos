import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses, type ButtonVariant } from "./button-classes";
import { Icon, type IconName } from "./icons";

export function LinkButton({
  href, children, variant = "primary", className, download, icon, newTab,
}: { href: string; children: ReactNode; variant?: ButtonVariant; className?: string; download?: boolean; icon?: IconName; newTab?: boolean }) {
  const content = (
    <>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </>
  );
  // Téléchargement ou lien externe (mailto:) : <a> natif (une navigation client Next.js vers un fichier laisserait le routeur en attente).
  if (download || !href.startsWith("/")) {
    return (
      <a
        href={href}
        download={download || undefined}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
        className={buttonClasses({ variant, className })}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClasses({ variant, className })}>
      {content}
    </Link>
  );
}

/** Lien de retour discret au-dessus du titre (cible tactile de 44 px conservée). */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium text-ink-soft no-underline hover:text-ink">
      <Icon name="back" size={16} />
      {children}
    </Link>
  );
}

/** En-tête de page : titre condensé compact, contexte sur une ligne, actions à droite (dessous sur mobile). */
export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6">
      {back && <div className="-mt-2 mb-1">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-title font-bold font-stretch-[80%] tracking-[-0.01em] text-ink">{title}</h1>
          {description && <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
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

/**
 * Panneau : surface blanche sur filet de 1 px, coins de 4 px, aucune ombre. Jamais imbriqué dans un autre panneau :
 * un tableau ou une liste placé dedans utilise `flush` pour aller bord à bord.
 */
export function Card({
  title, description, children, actions, className, flush = false, id, as: Tag = "section",
}: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; flush?: boolean; id?: string; as?: "section" | "div" }) {
  const headingId = title ? `card-${slug(title)}` : undefined;
  return (
    <Tag id={id} aria-labelledby={headingId} className={`min-w-0 scroll-mt-6 rounded-sm border border-line bg-surface ${flush ? "" : "p-4 sm:p-5"} ${className ?? ""}`}>
      {(title || actions) && (
        <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${flush ? "border-b border-line px-4 py-3.5 sm:px-5" : "mb-4"}`}>
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-base font-bold text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

const badgeTones = {
  neutral: "bg-sunken text-ink-soft",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  brand: "bg-accent-soft text-accent-ink",
  ink: "bg-ink text-white",
} as const;

export type BadgeTone = keyof typeof badgeTones;

/** Étiquette d'état : une bande de ruban, rectangulaire, jamais une pastille. */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-xs px-2 py-0.5 text-xs font-semibold leading-4 ${badgeTones[tone]}`}>{children}</span>;
}

const alertTones = {
  info: { box: "border-line bg-surface text-ink", icon: "text-ink-soft", name: "clock" },
  success: { box: "border-success/30 bg-success-soft text-success-ink", icon: "text-success", name: "check" },
  warning: { box: "border-warning/35 bg-warning-soft text-warning-ink", icon: "text-warning", name: "alert" },
  danger: { box: "border-danger/30 bg-danger-soft text-danger-ink", icon: "text-danger", name: "alert" },
} as const satisfies Record<string, { box: string; icon: string; name: IconName }>;

export function Alert({ children, tone = "info", title }: { children: ReactNode; tone?: keyof typeof alertTones; title?: string }) {
  const t = alertTones[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={`mb-4 flex gap-3 rounded-sm border px-4 py-3 text-sm ${t.box}`}>
      <Icon name={t.name} size={18} className={`mt-px ${t.icon}`} />
      <div className="min-w-0">
        {title && <p className="font-bold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Quatre traits de comptage (bâtons) : « rien de compté pour l'instant ». Décoratif. */
export function TallyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true" focusable="false" className={className}>
      {[3, 9.5, 16, 22.5].map((x) => (
        <rect key={x} x={x} y="2" width="2.5" height="20" rx="0.5" className="fill-line-strong" />
      ))}
    </svg>
  );
}

/** État vide : ce qui manque, pourquoi, et l'action pour le remplir. Sans cadre en pointillé ni carte dans la carte. */
export function EmptyState({ title, children, action, level = 2, framed = false }: { title: string; children?: ReactNode; action?: ReactNode; level?: 2 | 3; framed?: boolean }) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className={`px-5 py-10 text-center ${framed ? "rounded-sm border border-line bg-surface" : ""}`}>
      <TallyGlyph className="mx-auto mb-4" />
      <Heading className="text-base font-bold text-ink">{title}</Heading>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Bande de compteurs : un seul panneau divisé par des filets (et non une rangée de cartes). */
export function StatGrid({ children, className, cols = 4 }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 }) {
  const grid = cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4";
  return <dl className={`grid gap-px overflow-hidden rounded-sm border border-line bg-line ${grid} ${className ?? ""}`}>{children}</dl>;
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  // Structure valide d'une liste de définitions : <div><dt/><dd/></div>. Le lien étend sa zone cliquable à toute la cellule.
  return (
    <div className={`relative bg-surface px-4 py-3.5 ${href ? "transition-colors hover:bg-hover" : ""}`}>
      <dt className="text-sm font-medium text-ink-soft">
        {href ? (
          <Link href={href} className="no-underline after:absolute after:inset-0 hover:text-ink">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1.5 text-figure font-bold font-stretch-[75%] text-ink">
        {value}
        {hint && <span className="mt-1.5 block text-xs font-normal font-stretch-100% text-ink-soft">{hint}</span>}
      </dd>
    </div>
  );
}

/**
 * Tableau accessible : en-têtes de colonnes, légende masquée, défilement horizontal si nécessaire.
 * `bare` : sans cadre, pour un tableau posé dans un panneau `flush`.
 */
// `relative` : les textes sr-only (position absolue) d'une cellule restent dans la zone défilante au lieu d'élargir la page.
export function DataTable({ caption, headers, children, bare = false, numeric = [] }: { caption: string; headers: string[]; children: ReactNode; bare?: boolean; numeric?: number[] }) {
  return (
    <div className={`relative overflow-x-auto ${bare ? "" : "rounded-sm border border-line bg-surface"}`}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-sunken text-xs font-semibold text-ink-soft">
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className={`px-4 py-2.5 font-semibold whitespace-nowrap ${numeric.includes(i) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr:hover]:bg-hover">{children}</tbody>
      </table>
    </div>
  );
}

/** Onglets de filtre : liens, l'onglet courant porte une bande d'encre (aria-current). */
export function TabNav({ label, items }: { label: string; items: { href: string; label: string; current: boolean; count?: number }[] }) {
  return (
    <nav aria-label={label} className="-mb-px flex overflow-x-auto">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-[3px] px-3 text-sm font-semibold no-underline transition-colors ${t.current ? "border-ink text-ink" : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"}`}
        >
          {t.label}
          {t.count !== undefined && <span className="text-xs font-medium text-ink-soft">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-ink-soft">
        Page {page} sur {pages} · {total} résultat{total > 1 ? "s" : ""}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonClasses({ variant: "secondary" })} href={hrefFor(page - 1)}>
            <Icon name="prev" size={18} />
            Précédent
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={buttonClasses({ variant: "secondary" })} href={hrefFor(page + 1)}>
            Suivant
            <Icon name="next" size={18} />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (Array.isArray(searchParams[k]) ? searchParams[k]?.[0] : (searchParams[k] as string | undefined));
  if (one("created")) {
    const n = Number(one("created")) || 1;
    const skipped = Number(one("skipped")) || 0;
    return (
      <Alert tone="success" title={n > 1 ? `${n} séances créées` : "Séance créée"}>
        Création effectuée : {n} séance{n > 1 ? "s" : ""}, visible{n > 1 ? "s" : ""} dans le planning ci-dessous.
        {skipped > 0 ? ` ${skipped} existai${skipped > 1 ? "ent" : "t"} déjà et ${skipped > 1 ? "ont" : "a"} été ignorée${skipped > 1 ? "s" : ""}.` : ""}
      </Alert>
    );
  }
  if (one("updated")) {
    const n = Number(one("updated")) || 1;
    return <Alert tone="success" title={n > 1 ? `${n} séances modifiées` : "Séance enregistrée"}>Vos modifications sont prises en compte dans le planning ci-dessous.</Alert>;
  }
  if (one("removed") !== undefined) {
    const removed = Number(one("removed")) || 0;
    const cancelled = Number(one("cancelledInstead")) || 0;
    const parts = [
      removed > 0 ? `${removed} séance${removed > 1 ? "s" : ""} supprimée${removed > 1 ? "s" : ""}` : null,
      cancelled > 0 ? `${cancelled} séance${cancelled > 1 ? "s" : ""} annulée${cancelled > 1 ? "s" : ""} au lieu d'être supprimée${cancelled > 1 ? "s" : ""}, car elle${cancelled > 1 ? "s avaient" : " avait"} des inscrits : ils sont prévenus par e-mail` : null,
    ].filter(Boolean);
    return <Alert tone="success">{parts.join(" ; ")}.</Alert>;
  }
  if (one("erased")) return <Alert tone="success">{one("erased") === "delete" ? "Membre supprimé définitivement." : "Membre anonymisé : ses présences sont conservées sous forme de statistiques non identifiantes."}</Alert>;
  if (one("deleted")) return <Alert tone="success">Élément supprimé.</Alert>;
  return null;
}
