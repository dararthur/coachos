"use server";

import { checkinProgress, type CheckinProgress } from "@/domain/assiduity";
import { localDate } from "@/domain/dates";
import { AppError, type ActionResult } from "@/domain/errors";
import { rankingRange } from "@/domain/ranking";
import { authorizeUser, runAction } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { myAttendanceAt, personHistory } from "@/server/repositories/attendance";
import { attendanceRanking, myRankingVisibility } from "@/server/repositories/ranking";

export interface CheckinProgressDto extends CheckinProgress {
  academyId: string;
  /** Le membre apparaît-il aux autres dans le classement ? (son rang lui reste visible dans tous les cas) */
  visible: boolean;
}

/**
 * Lecture seule, après un pointage confirmé par le serveur : la barrette d'assiduité, les venues du mois et le rang du
 * membre. Ne renvoie que des données sur l'appelant ; `null` si aucune présence ne correspond (rien n'est inventé).
 */
export async function checkinProgressAction(startsAt: string): Promise<ActionResult<CheckinProgressDto | null>> {
  return runAction("checkin.progress", async () => {
    const user = await authorizeUser();
    if (typeof startsAt !== "string" || Number.isNaN(Date.parse(startsAt))) throw new AppError("not_found");
    const data = await withUser(user, async (tx) => {
      const found = await myAttendanceAt(tx, startsAt);
      if (!found) return null;
      const { from, to } = rankingRange("mois", localDate(new Date(), found.timezone));
      const [history, ranking, visible] = [
        await personHistory(tx, found.academyId, found.personId, 400),
        await attendanceRanking(tx, found.academyId, from, to),
        await myRankingVisibility(tx, found.academyId),
      ];
      return { academyId: found.academyId, visible: visible === true, ...checkinProgress(history, ranking, found.timezone) };
    });
    return { ok: true, data };
  });
}
