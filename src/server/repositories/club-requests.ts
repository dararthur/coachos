import "server-only";
import { withApp, type Tx } from "@/server/db/client";

export interface ClubRequest {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  contactName: string;
  email: string;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "claimed";
  createdAt: Date;
}

export interface ApprovedRequest {
  id: string;
  name: string;
  timezone: string;
  currency: string;
}

// --- Sans compte (rôle serveur) -------------------------------------------------------------------------------------------------
export async function submitClubRequest(input: { name: string; timezone: string; currency: string; contactName: string; email: string; note: string | null }): Promise<{ id: string; isNew: boolean }> {
  const [row] = await withApp((tx) => tx<{ id: string; is_new: boolean }[]>`
    select id, is_new from app_private.submit_academy_request(${input.name}, ${input.timezone}, ${input.currency}, ${input.contactName}, ${input.email}, ${input.note})`);
  return { id: row!.id, isNew: row!.is_new };
}

export async function joinCodeValid(code: string): Promise<boolean> {
  const [row] = await withApp((tx) => tx<{ ok: boolean }[]>`select app_private.join_code_valid(${code}) as ok`);
  return row?.ok === true;
}

export async function signupEmailAllowed(email: string): Promise<boolean> {
  const [row] = await withApp((tx) => tx<{ ok: boolean }[]>`select app_private.signup_email_allowed(${email}) as ok`);
  return row?.ok === true;
}

/** Désigne l'administrateur de la plateforme (le serveur a vérifié que l'e-mail confirmé du compte est PLATFORM_ADMIN_EMAIL). */
export async function registerPlatformAdmin(userId: string): Promise<void> {
  await withApp((tx) => tx`select app_private.register_platform_admin(${userId})`);
}

export async function purgeClubRequests(): Promise<number> {
  const [row] = await withApp((tx) => tx<{ n: number }[]>`select app_private.purge_academy_requests() as n`);
  return row?.n ?? 0;
}

// --- Compte connecté (RLS) ------------------------------------------------------------------------------------------------------
export async function isPlatformAdmin(tx: Tx): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`select app_private.is_platform_admin() as ok`;
  return row?.ok === true;
}

export async function listClubRequests(tx: Tx): Promise<ClubRequest[]> {
  return tx<ClubRequest[]>`
    select id, name, timezone, currency, contact_name as "contactName", email, note, status, created_at as "createdAt"
    from public.list_academy_requests()`;
}

export async function decideClubRequest(tx: Tx, id: string, approve: boolean): Promise<{ email: string; contactName: string; name: string; status: string }> {
  const [row] = await tx<{ email: string; contactName: string; name: string; status: string }[]>`
    select email, contact_name as "contactName", name, status from public.decide_academy_request(${id}, ${approve})`;
  return row!;
}

export async function myApprovedRequest(tx: Tx): Promise<ApprovedRequest | null> {
  const [row] = await tx<ApprovedRequest[]>`select id, name, timezone, currency from public.my_approved_academy_request()`;
  return row ?? null;
}

export async function claimClubRequest(tx: Tx, input: { requestId: string; name: string; timezone: string; currency: string }): Promise<string> {
  const [row] = await tx<{ id: string }[]>`select public.claim_academy_request(${input.requestId}, ${input.name}, ${input.timezone}, ${input.currency}) as id`;
  return row!.id;
}
