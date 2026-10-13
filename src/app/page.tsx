import { redirect } from "next/navigation";
import { can } from "@/domain/roles";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { listAcademiesForUser } from "@/server/repositories/academies";

export default async function Home() {
  const user = await requireUser();
  const academies = await withUser(user, (tx) => listAcademiesForUser(tx, user.id));
  if (academies.length === 0) redirect("/onboarding");
  const only = academies[0];
  if (academies.length === 1 && only) redirect(can(only.role, "dashboard.read") ? `/a/${only.id}/dashboard` : `/a/${only.id}/me`);
  redirect("/academies");
}
