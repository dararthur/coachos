import "server-only";
import { assessEligibility, daysUntil, type Eligibility, type PromotionEntry } from "@/domain/graduation";
import type { Belt } from "@/domain/profile";
import type { Tx } from "@/server/db/client";

/**
 * Historique des passages et éligibilité : réservé à l'équipe. La table rank_promotions n'est lisible que par le staff du club (RLS) ;
 * l'éligibilité n'est jamais stockée, elle est calculée ici à chaque affichage. Voir docs/graduation.md.
 */

export interface PromotionRow extends PromotionEntry {
  id: string;
  source: "staff" | "member";
}

export async function listPromotions(tx: Tx, personId: string): Promise<PromotionRow[]> {
  return tx<PromotionRow[]>`
    select id, belt, stripes::int as stripes, promoted_on::text as "promotedOn", date_confirmed as confirmed, source
    from public.rank_promotions where person_id = ${personId}
    order by promoted_on, created_at, id`;
}

export async function recordPromotion(tx: Tx, personId: string, belt: Belt, stripes: number, on: string): Promise<void> {
  await tx`select public.record_promotion(${personId}, ${belt}, ${stripes}, ${on}::date)`;
}

export async function setBeltSince(tx: Tx, personId: string, on: string): Promise<void> {
  await tx`select public.set_belt_since(${personId}, ${on}::date)`;
}

export interface PromotionCandidate {
  id: string;
  firstName: string;
  lastName: string;
  belt: Belt;
  stripes: number;
  eligibility: Eligibility;
}

/** Jours à l'avance pour lesquels une éligibilité future est déjà signalée. */
const HORIZON_DAYS = 30;

/**
 * Adhérents actifs dont les minimums IBJJF sont atteints (ou le seront dans 30 jours) : de la plus ancienne éligibilité à la plus récente.
 * `total` compte tous les cas, `items` en garde `limit`.
 */
export async function listPromotionCandidates(tx: Tx, academyId: string, today: string, limit = 8): Promise<{ items: PromotionCandidate[]; total: number }> {
  const people = await tx<{ id: string; firstName: string; lastName: string; belt: Belt; stripes: number; birthDate: string | null }[]>`
    select id, first_name as "firstName", last_name as "lastName", belt, belt_stripes::int as stripes, birth_date::text as "birthDate"
    from public.people
    where academy_id = ${academyId} and archived_at is null and anonymized_at is null and belt is not null and belt <> 'black'`;
  if (people.length === 0) return { items: [], total: 0 };
  const ids = people.map((p) => p.id);
  const rows = await tx<(PromotionEntry & { personId: string })[]>`
    select person_id as "personId", belt, stripes::int as stripes, promoted_on::text as "promotedOn", date_confirmed as confirmed
    from public.rank_promotions where academy_id = ${academyId} and person_id = any(${ids}::uuid[])`;
  const byPerson = new Map<string, PromotionEntry[]>();
  for (const r of rows) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);

  const all: PromotionCandidate[] = [];
  for (const p of people) {
    const eligibility = assessEligibility({ belt: p.belt, birthDate: p.birthDate, history: byPerson.get(p.id) ?? [], today });
    const soon = eligibility.status === "waiting" && eligibility.eligibleOn !== null && daysUntil(eligibility.eligibleOn, today) <= HORIZON_DAYS;
    if (eligibility.status === "eligible" || soon) all.push({ id: p.id, firstName: p.firstName, lastName: p.lastName, belt: p.belt, stripes: p.stripes, eligibility });
  }
  all.sort((a, b) => (a.eligibility.eligibleOn ?? "").localeCompare(b.eligibility.eligibleOn ?? "") || a.lastName.localeCompare(b.lastName, "fr"));
  return { items: all.slice(0, limit), total: all.length };
}
