import { formatDateTime } from "@/domain/dates";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { Badge, DataTable } from "./ui";

const tone = (s: AttendanceStatus) => (s === "absent" ? "danger" : s === "late" ? "warning" : "success");

/**
 * Historique de présences (fiche membre, espace adhérent). Tableau à partir de 640 px ; en dessous, lignes empilées
 * (date et statut, puis cours) pour ne pas écraser trois colonnes sur un téléphone. Le tableau précède la liste dans le DOM.
 */
export function AttendanceHistory({ caption, rows, tz }: { caption: string; rows: { key: string; startsAt: Date; classTypeName: string; status: AttendanceStatus }[]; tz: string }) {
  return (
    <>
      <div className="hidden sm:block">
        <DataTable bare caption={caption} headers={["Séance", "Cours", "Statut"]}>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.startsAt, tz)}</td>
              <td className="px-4 py-2.5">{r.classTypeName}</td>
              <td className="px-4 py-2.5">
                <Badge tone={tone(r.status)}>{ATTENDANCE_LABELS[r.status]}</Badge>
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r) => (
          <li key={r.key} className="px-4 py-2.5">
            <p className="flex items-center justify-between gap-3">
              <span className="font-semibold">{formatDateTime(r.startsAt, tz)}</span>
              <Badge tone={tone(r.status)}>{ATTENDANCE_LABELS[r.status]}</Badge>
            </p>
            <p className="text-sm text-ink-soft">{r.classTypeName}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
