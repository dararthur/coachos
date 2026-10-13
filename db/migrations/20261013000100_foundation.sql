-- Coach OS — 0001 fondation : schéma privé, rôles, profils, académies, appartenances, audit, limitation de débit.
--
-- Principes (voir docs/security.md) :
--   * Toute table de `public` a la RLS activée ; `anon` n'a AUCUN privilège.
--   * L'application se connecte avec le rôle `app_server` (NOINHERIT, sans droit sur les tables) puis
--     fait `SET LOCAL ROLE authenticated` avec les claims JWT de l'utilisateur dans chaque transaction.
--   * Les fonctions SECURITY DEFINER fixent `search_path = ''` et re-vérifient les droits elles-mêmes.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- Rôle de connexion de l'application. Le mot de passe / LOGIN est configuré hors migration
-- (voir docs/setup.md) : aucun secret dans Git.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_server') then
    create role app_server nologin noinherit;
  end if;
end
$$;
grant authenticated to app_server;
grant usage on schema app_private to app_server;

-- Les fonctions sont exécutables par PUBLIC par défaut : on inverse la valeur par défaut.
-- (Sans IN SCHEMA : seul moyen de retirer le EXECUTE implicite de PUBLIC pour les futures fonctions.)
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------------
create function app_private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- L'académie d'une ligne ne peut jamais changer : empêche de « déplacer » des données entre tenants.
create function app_private.forbid_academy_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.academy_id is distinct from old.academy_id then
    raise exception 'coachos:academy_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Profils (identité minimale, liée à auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app_private.set_updated_at();

create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100)
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create function app_private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app_private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Académies (tenants) et appartenances
-- ---------------------------------------------------------------------------
create table public.academies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  timezone text not null default 'Europe/Paris',
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  -- Un membre archivé est anonymisé automatiquement après ce délai (voir purge_expired_data).
  retention_months integer not null default 24 check (retention_months between 6 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger academies_updated_at before update on public.academies
  for each row execute function app_private.set_updated_at();

create function app_private.validate_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'coachos:invalid_timezone' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger academies_validate_timezone before insert or update of timezone on public.academies
  for each row execute function app_private.validate_timezone();

create table public.academy_memberships (
  academy_id uuid not null references public.academies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'coach', 'member')),
  created_at timestamptz not null default now(),
  primary key (academy_id, user_id)
);
create index academy_memberships_user_idx on public.academy_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Audit (append-only, sans donnée personnelle) et limitation de débit
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  -- Pas de clé étrangère : la trace de suppression d'une académie doit survivre à la suppression.
  academy_id uuid,
  actor_user_id uuid,
  action text not null check (char_length(action) between 3 and 60),
  entity_type text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) < 2048),
  created_at timestamptz not null default now()
);
create index audit_events_academy_idx on public.audit_events (academy_id, created_at desc);
create index audit_events_created_idx on public.audit_events (created_at);

create table app_private.rate_limits (
  key text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null
);

create function app_private.write_audit(
  p_academy uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_events (academy_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_academy, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function app_private.write_audit(uuid, uuid, text, text, uuid, jsonb) from public;

-- Fenêtre fixe : retourne true si l'appel est autorisé. Réservée à app_server.
create function app_private.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hits integer;
begin
  insert into app_private.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case
          when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else r.window_start end,
        hits = case
          when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else r.hits + 1 end
  returning hits into v_hits;
  return v_hits <= p_max;
end
$$;
revoke all on function app_private.hit_rate_limit(text, integer, integer) from public;
grant execute on function app_private.hit_rate_limit(text, integer, integer) to app_server;

-- ---------------------------------------------------------------------------
-- Aides RLS (SECURITY DEFINER pour éviter la récursion de policies sur academy_memberships)
-- ---------------------------------------------------------------------------
create function app_private.member_role(p_academy uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.academy_memberships m
  where m.academy_id = p_academy and m.user_id = (select auth.uid());
$$;

create function app_private.is_member(p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_memberships m
    where m.academy_id = p_academy and m.user_id = (select auth.uid())
  );
$$;

create function app_private.is_staff(p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.member_role(p_academy) in ('owner', 'admin', 'coach'), false);
$$;

create function app_private.is_admin(p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.member_role(p_academy) in ('owner', 'admin'), false);
$$;

create function app_private.is_owner(p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.member_role(p_academy) = 'owner', false);
$$;

-- Le staff d'une académie voit les profils des autres personnes de cette académie.
create function app_private.shares_academy_with_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.academy_memberships me
    join public.academy_memberships other on other.academy_id = me.academy_id
    where me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin', 'coach')
      and other.user_id = p_user
  );
$$;

grant execute on function
  app_private.member_role(uuid), app_private.is_member(uuid), app_private.is_staff(uuid),
  app_private.is_admin(uuid), app_private.is_owner(uuid), app_private.shares_academy_with_staff(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS : profils, académies, appartenances, audit
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.academies enable row level security;
alter table public.academy_memberships enable row level security;
alter table public.audit_events enable row level security;
alter table app_private.rate_limits enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app_private.shares_academy_with_staff(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy academies_select on public.academies for select to authenticated
  using (app_private.is_member(id));
create policy academies_update on public.academies for update to authenticated
  using (app_private.is_admin(id)) with check (app_private.is_admin(id));
-- Pas de policy INSERT/DELETE : création via create_academy(), suppression via delete_academy().

create policy memberships_select on public.academy_memberships for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff(academy_id));
-- Pas de policy INSERT/UPDATE/DELETE : tout passe par des fonctions qui appliquent la hiérarchie des rôles.

create policy audit_select on public.audit_events for select to authenticated
  using (academy_id is not null and app_private.is_admin(academy_id));

-- ---------------------------------------------------------------------------
-- Privilèges de table (principe du moindre privilège)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.academies, public.academy_memberships, public.audit_events
  from anon, authenticated, public;
revoke all on app_private.rate_limits from anon, authenticated, public;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.academies to authenticated;
grant update (name, timezone, currency, locale, retention_months) on public.academies to authenticated;
grant select on public.academy_memberships to authenticated;
grant select on public.audit_events to authenticated;

create function app_private.audit_academy_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.write_audit(
    new.id, (select auth.uid()), 'academy.settings_updated', 'academy', new.id,
    jsonb_build_object(
      'name_changed', old.name is distinct from new.name,
      'timezone_changed', old.timezone is distinct from new.timezone,
      'currency_changed', old.currency is distinct from new.currency,
      'retention_changed', old.retention_months is distinct from new.retention_months
    )
  );
  return new;
end
$$;

create trigger academies_audit_update after update on public.academies
  for each row when (
    old.name is distinct from new.name or old.timezone is distinct from new.timezone
    or old.currency is distinct from new.currency or old.retention_months is distinct from new.retention_months
  )
  execute function app_private.audit_academy_update();
