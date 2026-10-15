import { redirect } from "next/navigation";
import { can } from "@/domain/roles";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { listAcademiesForUser } from "@/server/repositories/academies";
import { myChildrenWithSessions } from "@/server/repositories/guardian";

export default async function Home() {
  const user = await requireUser();
  const { academies, children } = await withUser(user, async (tx) => ({ academies: await listAcademiesForUser(tx, user.id), children: await myChildrenWithSessions(tx) }));
  // Un responsable sans club n'est pas un futur propriétaire : il retrouve ses enfants sur « Mes clubs ».
  if (academies.length === 0) redirect(children.length > 0 ? "/academies" : "/onboarding");
  const only = academies[0];
  if (academies.length === 1 && only) redirect(can(only.role, "dashboard.read") ? `/a/${only.id}/dashboard` : `/a/${only.id}/me`);
  redirect("/academies");
}
