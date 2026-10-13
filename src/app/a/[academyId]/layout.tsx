import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireAcademy } from "@/server/auth/guards";

export default async function AcademyLayout({ children, params }: { children: ReactNode; params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId);
  return (
    <AppShell academy={{ id: ctx.academy.id, name: ctx.academy.name }} role={ctx.role} userLabel={ctx.user.email ?? ctx.user.displayName}>
      {children}
    </AppShell>
  );
}
