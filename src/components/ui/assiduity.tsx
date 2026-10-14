import { addDays, localDate, mondayOf } from "@/domain/dates";

const WEEKS = 8;

/** Lundis (AAAA-MM-JJ, fuseau du club) des 8 dernières semaines, la plus ancienne d'abord. */
function lastMondays(tz: string): string[] {
  const thisMonday = mondayOf(localDate(new Date(), tz));
  return Array.from({ length: WEEKS }, (_, i) => addDays(thisMonday, -7 * (WEEKS - 1 - i)));
}

/** À partir des lundis des semaines avec une venue (ex. `attendedWeeks` de la liste des membres). */
export function weeksFromMondays(attended: string[] | undefined, tz: string): boolean[] {
  const seen = new Set(attended ?? []);
  return lastMondays(tz).map((m) => seen.has(m));
}

/** Pour chacune des 8 dernières semaines (la plus ancienne d'abord) : au moins une venue (présent ou en retard) ? */
export function weeksAttended(history: { startsAt: Date; status: string }[], tz: string): boolean[] {
  return weeksFromMondays(
    history.filter((h) => h.status !== "absent").map((h) => mondayOf(localDate(h.startsAt, tz))),
    tz,
  );
}

const label = (weeks: boolean[]) => {
  const n = weeks.filter(Boolean).length;
  return `Venu(e) ${n} semaine${n > 1 ? "s" : ""} sur ${WEEKS}`;
};

/** Barrette compacte pour une ligne de liste : une bande blanche par semaine avec une venue. */
export function TallyBar({ weeks }: { weeks: boolean[] }) {
  return (
    <span role="img" aria-label={label(weeks)} title={label(weeks)} className="tally tally-sm">
      {weeks.map((on, i) => (
        <span key={i} data-on={on} />
      ))}
    </span>
  );
}

/** Barrette d'assiduité : une bande de ruban blanc par semaine avec au moins une venue. */
export function Assiduity({ weeks }: { weeks: boolean[] }) {
  return (
    <div className="flex items-center gap-4 rounded-sm border border-line bg-surface px-4 py-3.5">
      <div className="tally" aria-hidden="true">
        {weeks.map((on, i) => (
          <span key={i} data-on={on} />
        ))}
      </div>
      <p className="text-sm">
        <span className="block font-semibold">Assiduité</span>
        <span className="text-ink-soft">{label(weeks)}</span>
      </p>
    </div>
  );
}
