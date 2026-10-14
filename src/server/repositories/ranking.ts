import "server-only";
import type { Tx } from "@/server/db/client";
import type { AvatarStyle, Belt } from "@/domain/profile";

export interface RankingRow {
  personId: string;
  firstName: string;
  lastName: string;
  visits: number;
  /** null : le membre connecté lui-même, sans venue sur la période. */
  rank: number | null;
  rankedTotal: number;
  isMe: boolean;
  belt: Belt | null;
  beltStripes: number;
  avatarStyle: AvatarStyle;
  hasPhoto: boolean;
}

/** Classement filtré par la base : un membre ne reçoit que sa ligne et celles des membres consentants. */
export async function attendanceRanking(tx: Tx, academyId: string, from: string, to: string): Promise<RankingRow[]> {
  const rows = await tx<RankingRow[]>`
    select person_id as "personId", first_name as "firstName", last_name as "lastName", visits, rank,
           ranked_total as "rankedTotal", is_me as "isMe", belt, belt_stripes as "beltStripes",
           avatar_style as "avatarStyle", has_photo as "hasPhoto"
    from public.attendance_ranking(${academyId}, ${from}::date, ${to}::date)`;
  return [...rows];
}

export async function myRankingVisibility(tx: Tx, academyId: string): Promise<boolean | null> {
  // La RLS ne renvoie à un membre que sa propre fiche ; le staff sans fiche liée obtient null.
  const [row] = await tx<{ v: boolean }[]>`
    select ranking_opt_in as v from public.people
    where academy_id = ${academyId} and user_id = (select auth.uid()) and anonymized_at is null`;
  return row ? row.v : null;
}

export async function setMyRankingVisibility(tx: Tx, academyId: string, visible: boolean): Promise<void> {
  await tx`select public.set_my_ranking_visibility(${academyId}, ${visible})`;
}
