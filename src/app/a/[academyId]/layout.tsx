import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireAcademy } from "@/server/auth/guards";
import { viewingAsMember } from "@/server/view-mode";

export default async function AcademyLayout({ children, params }: { children: ReactNode; params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  const viewAsMember = await viewingAsMember(ctx.role);
  return (
    <AppShell academy={{ id: ctx.academy.id, name: ctx.academy.name, logoVersion: ctx.academy.logoVersion }} role={ctx.role} viewAsMember={viewAsMember} userLabel={ctx.user.email ?? ctx.user.displayName}>
      {children}
    </AppShell>
  );
}
