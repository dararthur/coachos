import "server-only";
import type { Tx } from "@/server/db/client";
import type { PauseReason } from "@/domain/lifecycle";
import type { AvatarStyle, Belt } from "@/domain/profile";

export interface MyProfile {
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  belt: Belt | null;
  beltStripes: number;
  avatarStyle: AvatarStyle;
  adultAttested: boolean;
  completed: boolean;
  pausedUntil: string | null;
  pauseReason: PauseReason | null;
}

/** Fiche du compte connecté dans ce club (la RLS ne renvoie à un membre que sa propre fiche) ; null si le compte n'en a pas. */
export async function getMyProfile(tx: Tx, academyId: string): Promise<MyProfile | null> {
  const [row] = await tx<MyProfile[]>`
    select id as "personId", first_name as "firstName", last_name as "lastName", email, phone, belt, belt_stripes as "beltStripes",
           avatar_style as "avatarStyle", adult_attested_at is not null as "adultAttested", profile_completed_at is not null as completed,
           paused_until::text as "pausedUntil", pause_reason as "pauseReason"
    from public.people
    where academy_id = ${academyId} and user_id = (select auth.uid()) and anonymized_at is null and archived_at is null`;
  return row ?? null;
}

export interface ProfileInput {
  firstName: string;
  lastName: string;
  phone: string | null;
  belt: Belt | null;
  beltStripes: number;
  avatarStyle: AvatarStyle;
  adultConfirmed: boolean;
}

export async function updateMyProfile(tx: Tx, academyId: string, i: ProfileInput): Promise<void> {
  await tx`select public.update_my_profile(${academyId}, ${i.firstName}, ${i.lastName}, ${i.phone}, ${i.belt}, ${i.beltStripes}, ${i.avatarStyle}, ${i.adultConfirmed})`;
}

/** Ma pause (l'adhérent la pose lui-même ; consentement exigé par la base pour blessure et maladie). */
export async function setMyPause(tx: Tx, academyId: string, until: string, reason: PauseReason, consent: boolean): Promise<void> {
  await tx`select public.set_my_pause(${academyId}, ${until}::date, ${reason}, ${consent})`;
}

export async function clearMyPause(tx: Tx, academyId: string): Promise<void> {
  await tx`select public.clear_my_pause(${academyId})`;
}
