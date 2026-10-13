-- Coach OS — 0000 socle de plateforme (PostgreSQL standard + Better Auth).
--
-- Remplace ce que fournissait Supabase : rôles de base, schéma `auth`, tables d'authentification et auth.uid().
-- À exécuter AVANT les autres migrations, par un rôle autorisé à créer des rôles (administrateur de la base).
-- Aucun mot de passe ici : LOGIN et mots de passe de app_server et auth_runtime sont posés hors Git (docs/setup.md).
--
-- Tables d'authentification : DDL généré par Better Auth 1.7.7 (getMigrations().compileMigrations(), UUID, snake_case,
-- noms de modèles `users|sessions|accounts|verifications`), reproduit ici pour être versionné. Le test
-- tests/db/better-auth-schema.test.ts échoue si une mise à jour de Better Auth demande un schéma différent.
--
-- RISQUE RÉSIDUEL DOCUMENTÉ (docs/security.md §Sessions) : auth.sessions.token est stocké en clair — Better Auth ne propose
-- aucune option documentée pour le hacher. Mesures : le cookie exige une signature HMAC (BETTER_AUTH_SECRET) que la base
-- ne contient pas ; aucun rôle sauf auth_runtime n'a de droit sur ces tables ; sauvegardes chiffrées et SANS le secret.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- Rôle de connexion de Better Auth : DML sur auth.* uniquement, aucun droit sur les données métier.
  if not exists (select 1 from pg_roles where rolname = 'auth_runtime') then
    create role auth_runtime nologin noinherit;
  end if;
end
$$;

create schema if not exists auth;
revoke all on schema auth from public;
grant usage on schema auth to authenticated, auth_runtime;
-- anon n'a volontairement aucun accès au schéma auth.

create table auth.users (
  id uuid default pg_catalog.gen_random_uuid() not null primary key,
  name text not null,
  email text not null unique check (email = lower(btrim(email))),
  email_verified boolean not null,
  image text,
  created_at timestamptz default current_timestamp not null,
  updated_at timestamptz default current_timestamp not null
);

create table auth.sessions (
  id uuid default pg_catalog.gen_random_uuid() not null primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz default current_timestamp not null,
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id uuid not null references auth.users (id) on delete cascade
);

create table auth.accounts (
  id uuid default pg_catalog.gen_random_uuid() not null primary key,
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz default current_timestamp not null,
  updated_at timestamptz not null
);

create table auth.verifications (
  id uuid default pg_catalog.gen_random_uuid() not null primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz default current_timestamp not null,
  updated_at timestamptz default current_timestamp not null
);

create index sessions_user_id_idx on auth.sessions (user_id);
create index accounts_user_id_idx on auth.accounts (user_id);
create index verifications_identifier_idx on auth.verifications (identifier);
create index sessions_expires_at_idx on auth.sessions (expires_at);
create index verifications_expires_at_idx on auth.verifications (expires_at);

-- Aucun rôle applicatif (anon, authenticated, app_server) ne lit ces tables : les fonctions SECURITY DEFINER sont le seul chemin.
revoke all on all tables in schema auth from public, anon, authenticated;
grant select, insert, update, delete on auth.users, auth.sessions, auth.accounts, auth.verifications to auth_runtime;

-- Identité de la requête : les politiques RLS et les fonctions SECURITY DEFINER de Coach OS lisent auth.uid().
-- L'application ne la pose qu'après avoir validé la session côté serveur (src/server/db/client.ts : withUser).
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
revoke all on function auth.uid() from public;
grant execute on function auth.uid() to authenticated;
-- anon : pas d'accès (aucune politique ne s'applique à anon).

grant usage on schema public to anon, authenticated;
