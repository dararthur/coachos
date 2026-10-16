-- Coach OS — double authentification de l'administrateur de la plateforme, par code envoyé à son adresse e-mail.
--
-- Après son mot de passe, le compte désigné par PLATFORM_ADMIN_EMAIL doit saisir un code à 6 chiffres reçu par e-mail pour ouvrir
-- l'administration. Le code est : lié à la SESSION qui l'a demandé, valable 10 minutes, limité à 5 essais, à usage unique, et remplacé
-- par tout nouveau code. La base ne conserve qu'une empreinte HMAC du code (clé APP_SECRET, absente de la base et des sauvegardes).
-- Les tables ne sont lisibles par aucun compte : tout passe par des fonctions réservées au serveur (app_server) qui refusent tout
-- compte autre que l'administrateur désigné.

create table public.platform_admin_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.platform_admins (user_id) on delete cascade,
  session_id text not null check (char_length(session_id) between 1 and 200),
  code_hash text not null check (char_length(code_hash) = 64),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index platform_admin_codes_lookup_idx on public.platform_admin_codes (user_id, session_id, created_at desc);
alter table public.platform_admin_codes enable row level security;
alter table public.platform_admin_codes force row level security;
revoke all on public.platform_admin_codes from public, anon, authenticated;

create function app_private.assert_platform_admin_user(p_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user is null or not exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
end
$$;
revoke all on function app_private.assert_platform_admin_user(uuid) from public, anon, authenticated;

-- Enregistre un nouveau code pour cette session ; tout code encore en attente de cet administrateur est invalidé (un seul actif à la fois).
create function app_private.admin_code_issue(p_user uuid, p_session text, p_hash text, p_ttl_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.assert_platform_admin_user(p_user);
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 3600 then
    raise exception 'coachos:validation' using errcode = 'P0001';
  end if;
  delete from public.platform_admin_codes where user_id = p_user and (used_at is null or created_at < now() - interval '1 day');
  insert into public.platform_admin_codes (user_id, session_id, code_hash, expires_at)
  values (p_user, p_session, p_hash, now() + make_interval(secs => p_ttl_seconds));
end
$$;

-- Un code est-il en attente pour cette session ? Renvoie son échéance (pour l'affichage), sinon rien.
create function app_private.admin_code_pending(p_user uuid, p_session text) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  v_expires timestamptz;
begin
  perform app_private.assert_platform_admin_user(p_user);
  select c.expires_at into v_expires from public.platform_admin_codes c
  where c.user_id = p_user and c.session_id = p_session and c.used_at is null and c.expires_at > now() and c.attempts < 5
  order by c.created_at desc limit 1;
  return v_expires;
end
$$;

-- Vérifie le code de CETTE session : vrai une seule fois. Chaque essai, réussi ou non, compte ; au 5e échec le code est mort.
create function app_private.admin_code_check(p_user uuid, p_session text, p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.platform_admin_codes%rowtype;
begin
  perform app_private.assert_platform_admin_user(p_user);
  select * into v_row from public.platform_admin_codes c
  where c.user_id = p_user and c.session_id = p_session and c.used_at is null and c.expires_at > now()
  order by c.created_at desc limit 1
  for update;
  if not found or v_row.attempts >= 5 then
    return false;
  end if;
  update public.platform_admin_codes set attempts = attempts + 1 where id = v_row.id;
  if v_row.code_hash = p_hash then
    update public.platform_admin_codes set used_at = now() where id = v_row.id;
    return true;
  end if;
  return false;
end
$$;

revoke all on function app_private.admin_code_issue(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function app_private.admin_code_pending(uuid, text) from public, anon, authenticated;
revoke all on function app_private.admin_code_check(uuid, text, text) from public, anon, authenticated;
grant execute on function app_private.admin_code_issue(uuid, text, text, integer) to app_server;
grant execute on function app_private.admin_code_pending(uuid, text) to app_server;
grant execute on function app_private.admin_code_check(uuid, text, text) to app_server;
