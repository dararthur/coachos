-- Coach OS — 0004 équipe, rôles et invitations.
-- Hiérarchie : owner > admin > coach > member.
--   * owner : tout, y compris nommer/retirer des admins et d'autres owners.
--   * admin : gère coachs et membres (jamais owner/admin).
--   * coach / member : aucune gestion d'équipe.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email = lower(email)),
  role text not null check (role in ('admin', 'coach', 'member')),
  person_id uuid,
  -- Seul le hachage SHA-256 du jeton est stocké ; le jeton en clair n'est montré qu'une fois.
  token_hash text not null unique check (char_length(token_hash) = 64),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (person_id, academy_id) references public.people (id, academy_id) on delete cascade
);
create index invitations_academy_idx on public.invitations (academy_id, created_at desc);

alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated
  using (app_private.is_admin(academy_id));
create policy invitations_delete on public.invitations for delete to authenticated
  using (app_private.is_admin(academy_id) and accepted_at is null);
revoke all on public.invitations from anon, authenticated, public;
grant select, delete on public.invitations to authenticated;

create function public.create_invitation(
  p_academy uuid, p_email text, p_role text, p_person_id uuid, p_token_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller text;
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  v_caller := app_private.member_role(p_academy);
  if coalesce(v_caller, '') not in ('owner', 'admin') then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'coach', 'member') then
    raise exception 'coachos:invalid_role' using errcode = 'P0001';
  end if;
  if p_role = 'admin' and v_caller <> 'owner' then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'coachos:invalid_email' using errcode = 'P0001';
  end if;
  if p_person_id is not null then
    if p_role <> 'member' or not exists (
      select 1 from public.people where id = p_person_id and academy_id = p_academy and anonymized_at is null
    ) then
      raise exception 'coachos:invalid_person' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.invitations
        where academy_id = p_academy and accepted_at is null and expires_at > now()) >= 100 then
    raise exception 'coachos:invitation_limit_reached' using errcode = 'P0001';
  end if;

  -- Une seule invitation en attente par adresse et par académie.
  delete from public.invitations where academy_id = p_academy and email = v_email and accepted_at is null;
  insert into public.invitations (academy_id, email, role, person_id, token_hash, invited_by, expires_at)
  values (p_academy, v_email, p_role, p_person_id, p_token_hash, v_uid, now() + interval '7 days')
  returning id into v_id;

  perform app_private.write_audit(p_academy, v_uid, 'team.invited', 'invitation', v_id,
    jsonb_build_object('role', p_role));
  return v_id;
end
$$;

create function public.accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then
    raise exception 'coachos:email_not_confirmed' using errcode = 'P0001';
  end if;

  select * into v_inv from public.invitations
  where token_hash = p_token_hash and accepted_at is null and expires_at > now()
  for update;
  -- Message volontairement identique pour jeton inconnu / expiré / destiné à un autre compte.
  if not found or lower(v_email) <> v_inv.email then
    raise exception 'coachos:invitation_invalid' using errcode = 'P0001';
  end if;

  insert into public.academy_memberships (academy_id, user_id, role)
  values (v_inv.academy_id, v_uid, v_inv.role)
  on conflict (academy_id, user_id) do nothing;

  if v_inv.person_id is not null then
    update public.people set user_id = v_uid
    where id = v_inv.person_id and academy_id = v_inv.academy_id and user_id is null
      and not exists (select 1 from public.people o
                      where o.academy_id = v_inv.academy_id and o.user_id = v_uid);
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  perform app_private.write_audit(v_inv.academy_id, v_uid, 'team.joined', 'invitation', v_inv.id,
    jsonb_build_object('role', v_inv.role));
  return v_inv.academy_id;
end
$$;

create function public.set_member_role(p_academy uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller text;
  v_target text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  v_caller := app_private.member_role(p_academy);
  if coalesce(v_caller, '') not in ('owner', 'admin') then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'coach', 'member') then
    raise exception 'coachos:invalid_role' using errcode = 'P0001';
  end if;
  select role into v_target from public.academy_memberships where academy_id = p_academy and user_id = p_user;
  if v_target is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_caller = 'admin' and (v_target in ('owner', 'admin') or p_role in ('owner', 'admin')) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if v_target = 'owner' and p_role <> 'owner'
     and (select count(*) from public.academy_memberships where academy_id = p_academy and role = 'owner') <= 1 then
    raise exception 'coachos:last_owner' using errcode = 'P0001';
  end if;

  update public.academy_memberships set role = p_role where academy_id = p_academy and user_id = p_user;
  perform app_private.write_audit(p_academy, v_uid, 'team.role_changed', 'user', p_user,
    jsonb_build_object('from', v_target, 'to', p_role));
end
$$;

create function public.remove_member(p_academy uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller text;
  v_target text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  v_caller := app_private.member_role(p_academy);
  select role into v_target from public.academy_memberships where academy_id = p_academy and user_id = p_user;
  if v_caller is null or v_target is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if p_user <> v_uid then
    if coalesce(v_caller, '') not in ('owner', 'admin') or (v_caller = 'admin' and v_target in ('owner', 'admin')) then
      raise exception 'coachos:forbidden' using errcode = '42501';
    end if;
  end if;
  if v_target = 'owner'
     and (select count(*) from public.academy_memberships where academy_id = p_academy and role = 'owner') <= 1 then
    raise exception 'coachos:last_owner' using errcode = 'P0001';
  end if;

  delete from public.academy_memberships where academy_id = p_academy and user_id = p_user;
  update public.people set user_id = null where academy_id = p_academy and user_id = p_user;
  perform app_private.write_audit(p_academy, v_uid, 'team.removed', 'user', p_user,
    jsonb_build_object('role', v_target, 'self', p_user = v_uid));
end
$$;

revoke all on function public.create_invitation(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_invitation(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
