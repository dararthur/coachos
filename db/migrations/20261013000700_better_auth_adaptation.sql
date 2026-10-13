-- Coach OS — 0007 adaptation à Better Auth (auth.users n'a plus raw_user_meta_data ni email_confirmed_at).
--
-- Better Auth fournit `name` (text) et `email_verified` (boolean). Seuls deux objets lisaient les anciennes colonnes :
-- le déclencheur de création de profil et accept_invitation. Les migrations 0001–0006 n'ont jamais été appliquées
-- à un environnement partagé ; elles restent inchangées et cette migration les corrige (additive).

create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, left(coalesce(new.name, ''), 100))
  on conflict (id) do nothing;
  return new;
end
$$;

-- Identique à 0004 : seule la lecture de la confirmation d'e-mail change (email_verified au lieu de email_confirmed_at).
create or replace function public.accept_invitation(p_token_hash text) returns uuid
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
  select email, case when email_verified then now() end into v_email, v_confirmed from auth.users where id = v_uid;
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

-- Purge de rétention de l'authentification : sessions et jetons expirés. Appelée par /api/cron/purge avec la purge métier.
create function app_private.purge_expired_auth() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sessions integer;
  v_verifications integer;
begin
  delete from auth.sessions where expires_at < now();
  get diagnostics v_sessions = row_count;
  delete from auth.verifications where expires_at < now();
  get diagnostics v_verifications = row_count;
  return jsonb_build_object('auth_sessions_deleted', v_sessions, 'auth_verifications_deleted', v_verifications);
end
$$;
revoke all on function app_private.purge_expired_auth() from public;
grant execute on function app_private.purge_expired_auth() to app_server;
