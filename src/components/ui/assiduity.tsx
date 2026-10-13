import { addDays, localDate, mondayOf } from "@/domain/dates";

const WEEKS = 8;

/** Pour chacune des 8 dernières semaines (la plus ancienne d'abord) : au moins une venue (présent ou en retard) ? */
export function weeksAttended(history: { startsAt: Date; status: string }[], tz: string): boolean[] {
  const thisMonday = mondayOf(localDate(new Date(), tz));
  const mondays = Array.from({ length: WEEKS }, (_, i) => addDays(thisMonday, -7 * (WEEKS - 1 - i)));
  const seen = new Set(history.filter((h) => h.status !== "absent").map((h) => mondayOf(localDate(h.startsAt, tz))));
  return mondays.map((m) => seen.has(m));
}

/** Barrette d'assiduité : une bande de ruban blanc par semaine avec au moins une venue. */
export function Assiduity({ weeks }: { weeks: boolean[] }) {
  const n = weeks.filter(Boolean).length;
  return (
    <div className="flex items-center gap-4 rounded-sm border border-line bg-surface px-4 py-3.5">
      <div className="tally" aria-hidden="true">
        {weeks.map((on, i) => (
          <span key={i} data-on={on} />
        ))}
      </div>
      <p className="text-sm">
        <span className="block font-semibold">Assiduité</span>
        <span className="text-ink-soft">
          Venu(e) {n} semaine{n > 1 ? "s" : ""} sur {WEEKS}
        </span>
      </p>
    </div>
  );
}
