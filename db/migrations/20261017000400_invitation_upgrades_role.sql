-- Invitation acceptée par un compte déjà dans le club (audit du 2026-10-17).
--
-- Défaut corrigé : un adhérent invité comme coach (cas courant : le club confie un cours à un de ses membres) acceptait l'invitation, qui
-- était consommée, mais restait « membre » : l'adhésion existante n'était pas touchée (« on conflict do nothing »), sans aucun message.
-- Règle : le compte prend le rôle de l'invitation s'il est PLUS ÉLEVÉ que son rôle actuel (membre < coach < administrateur), jamais un
-- rôle inférieur, et le propriétaire n'est jamais modifié. L'invitation elle-même reste bornée par create_invitation (seul un
-- propriétaire invite un administrateur). Le changement est journalisé comme un changement de rôle.
create or replace function public.accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed boolean;
  v_before text;
  v_rank constant jsonb := '{"member": 1, "coach": 2, "admin": 3, "owner": 4}';
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select email, email_verified into v_email, v_confirmed from auth.users where id = v_uid;
  if not coalesce(v_confirmed, false) then
    raise exception 'coachos:email_not_confirmed' using errcode = 'P0001';
  end if;

  select * into v_inv from public.invitations
  where token_hash = p_token_hash and accepted_at is null and expires_at > now()
  for update;
  if not found or lower(v_email) <> v_inv.email then
    raise exception 'coachos:invitation_invalid' using errcode = 'P0001';
  end if;

  select role into v_before from public.academy_memberships where academy_id = v_inv.academy_id and user_id = v_uid for update;
  if v_before is null then
    insert into public.academy_memberships (academy_id, user_id, role) values (v_inv.academy_id, v_uid, v_inv.role);
  elsif (v_rank ->> v_inv.role)::int > (v_rank ->> v_before)::int then
    update public.academy_memberships set role = v_inv.role where academy_id = v_inv.academy_id and user_id = v_uid;
    perform app_private.write_audit(v_inv.academy_id, v_uid, 'team.role_changed', 'user', v_uid,
      jsonb_build_object('from', v_before, 'to', v_inv.role, 'by', 'invitation'));
  end if;

  if v_inv.person_id is not null then
    update public.people set user_id = v_uid
    where id = v_inv.person_id and academy_id = v_inv.academy_id and user_id is null
      and not exists (select 1 from public.people o
                      where o.academy_id = v_inv.academy_id and o.user_id = v_uid);
  end if;
  if v_inv.role = 'member' then
    perform app_private.ensure_member_record(v_inv.academy_id, v_uid);
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  perform app_private.write_audit(v_inv.academy_id, v_uid, 'team.joined', 'invitation', v_inv.id,
    jsonb_build_object('role', v_inv.role));
  return v_inv.academy_id;
end
$$;
