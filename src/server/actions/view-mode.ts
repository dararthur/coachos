"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/domain/roles";
import { authorizeAcademy, inAcademy, runAction } from "@/server/auth/guards";
import { env } from "@/server/env";
import { VIEW_COOKIE } from "@/server/view-mode";

/** Passe l'équipe en « mode membre » (sa fiche d'adhérent est créée au besoin) ou la ramène à son espace de travail. */
export async function switchViewAction(academyId: string, mode: "member" | "staff", _formData: FormData): Promise<void> {
  // Un refus (compte hors club) laisse simplement la page en l'état ; les redirections traversent runAction.
  await runAction("switchView", async () => {
    const ctx = await authorizeAcademy(academyId);
    const jar = await cookies();
    if (mode === "member") {
      await inAcademy(ctx, (tx) => tx`select public.ensure_my_member_record(${academyId})`);
      jar.set(VIEW_COOKIE, "member", { httpOnly: true, sameSite: "lax", secure: env().SITE_URL.startsWith("https:"), path: "/", maxAge: 60 * 60 * 24 * 365 });
      redirect(`/a/${academyId}/me`);
    }
    jar.delete(VIEW_COOKIE);
    redirect(can(ctx.role, "dashboard.read") ? `/a/${academyId}/dashboard` : `/a/${academyId}/schedule`);
  });
}
