-- Coach OS — 0018 garde-fous : création de club sur approbation, création de compte sur « ticket ».
--
-- Avant : tout compte confirmé pouvait créer un club (create_academy) et n'importe qui pouvait s'inscrire.
-- Maintenant :
--   * un club n'est créé qu'après une DEMANDE approuvée par un administrateur de la plateforme (table platform_admins) ;
--   * un compte ne se crée qu'avec un code de club, une invitation de l'équipe en attente pour son adresse, ou une demande de club approuvée.
-- L'adresse de l'administrateur de la plateforme n'est JAMAIS en base : elle vient de l'environnement du serveur (PLATFORM_ADMIN_EMAIL).
-- La base ne connaît que l'identifiant du compte désigné (platform_admins), enregistré par le serveur après vérification de l'e-mail.

-- ---------------------------------------------------------------------------
-- Administrateurs de la plateforme (identifiants uniquement)
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated, public;

create function app_private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
$$;
revoke all on function app_private.is_platform_admin() from public;
grant execute on function app_private.is_platform_admin() to authenticated;

-- Réservée au serveur (app_server) : il désigne le compte dont l'e-mail CONFIRMÉ correspond à PLATFORM_ADMIN_EMAIL.
create function app_private.register_platform_admin(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users where id = p_user and email_verified) then
    raise exception 'coachos:email_not_confirmed' using errcode = 'P0001';
  end if;
  -- Un seul administrateur : celui que l'environnement désigne. Un changement de PLATFORM_ADMIN_EMAIL retire l'ancien dès la prochaine connexion du nouveau.
  delete from public.platform_admins where user_id <> p_user;
  insert into public.platform_admins (user_id) values (p_user) on conflict do nothing;
end
$$;
revoke all on function app_private.register_platform_admin(uuid) from public;
grant execute on function app_private.register_platform_admin(uuid) to app_server;

-- ---------------------------------------------------------------------------
-- Demandes de création de club
-- ---------------------------------------------------------------------------
create table public.academy_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  timezone text not null default 'Europe/Paris' check (char_length(timezone) between 1 and 64),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 100),
  email text not null check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email) <= 254),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'claimed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  academy_id uuid references public.academies (id) on delete set null
);
create index academy_requests_email_idx on public.academy_requests (email);
create index academy_requests_status_idx on public.academy_requests (status, created_at desc);
alter table public.academy_requests enable row level security;
-- Aucune politique, aucun droit direct : tout passe par les fonctions ci-dessous.
revoke all on public.academy_requests from anon, authenticated, public;

-- Dépôt d'une demande (formulaire public, sans compte). Idempotent : la même demande en attente ou approuvée n'est pas dupliquée.
create function app_private.submit_academy_request(
  p_name text, p_timezone text, p_currency text, p_contact text, p_email text, p_note text
) returns table (id uuid, is_new boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  select r.id into v_id from public.academy_requests r
  where r.email = v_email and lower(r.name) = lower(btrim(p_name)) and r.status in ('pending', 'approved')
  limit 1;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;
  if (select count(*) from public.academy_requests r where r.email = v_email and r.status = 'pending') >= 3 then
    raise exception 'coachos:academy_request_limit' using errcode = 'P0001';
  end if;
  insert into public.academy_requests (name, timezone, currency, contact_name, email, note)
  values (btrim(p_name), p_timezone, upper(p_currency), btrim(p_contact), v_email, nullif(btrim(coalesce(p_note, '')), ''))
  returning academy_requests.id into v_id;
  return query select v_id, true;
end
$$;
revoke all on function app_private.submit_academy_request(text, text, text, text, text, text) from public;
grant execute on function app_private.submit_academy_request(text, text, text, text, text, text) to app_server;

-- Liste pour l'administrateur de la plateforme (les en-attente d'abord).
create function public.list_academy_requests() returns table (
  id uuid, name text, timezone text, currency text, contact_name text, email text, note text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    select r.id, r.name, r.timezone, r.currency, r.contact_name, r.email, r.note, r.status, r.created_at
    from public.academy_requests r
    order by (r.status = 'pending') desc, r.created_at desc
    limit 100;
end
$$;

-- Décision (approuver ou refuser) : seulement sur une demande en attente.
create function public.decide_academy_request(p_id uuid, p_approve boolean) returns table (
  email text, contact_name text, name text, status text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    with decided as (
      update public.academy_requests r
      set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = v_uid
      where r.id = p_id and r.status = 'pending'
      returning r.email, r.contact_name, r.name, r.status
    )
    select d.email, d.contact_name, d.name, d.status from decided d;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
end
$$;

-- La demande approuvée (pas encore utilisée) de l'adresse CONFIRMÉE du compte connecté.
create function public.my_approved_academy_request() returns table (id uuid, name text, timezone text, currency text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  return query
    select r.id, r.name, r.timezone, r.currency
    from public.academy_requests r join auth.users u on u.id = v_uid and u.email_verified and lower(u.email) = r.email
    where r.status = 'approved'
    order by r.created_at
    limit 1;
end
$$;

-- Création du club à partir d'une demande approuvée : le nom, le fuseau et la devise peuvent être ajustés par le demandeur.
create function app_private.create_academy_for(p_user uuid, p_name text, p_timezone text, p_currency text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_discipline uuid;
begin
  -- Garde-fou anti-abus : nombre d'académies détenues par un même compte.
  if (select count(*) from public.academy_memberships where user_id = p_user and role = 'owner') >= 5 then
    raise exception 'coachos:academy_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.academies (name, timezone, currency, created_by)
  values (btrim(p_name), p_timezone, upper(p_currency), p_user)
  returning id into v_id;

  insert into public.academy_memberships (academy_id, user_id, role) values (v_id, p_user, 'owner');

  -- Disciplines de départ, modifiables ensuite.
  insert into public.disciplines (academy_id, name) values (v_id, 'Jiu-Jitsu Brésilien') returning id into v_discipline;
  insert into public.class_types (academy_id, discipline_id, name, default_duration_minutes)
  values (v_id, v_discipline, 'JJB — Tous niveaux', 60);
  insert into public.disciplines (academy_id, name) values (v_id, 'Grappling');
  insert into public.disciplines (academy_id, name) values (v_id, 'MMA');

  perform app_private.write_audit(v_id, p_user, 'academy.created', 'academy', v_id, '{}'::jsonb);
  return v_id;
end
$$;
revoke all on function app_private.create_academy_for(uuid, text, text, text) from public;

create function public.claim_academy_request(p_id uuid, p_name text, p_timezone text, p_currency text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_request public.academy_requests%rowtype;
  v_academy uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select r.* into v_request
  from public.academy_requests r join auth.users u on u.id = v_uid and u.email_verified and lower(u.email) = r.email
  where r.id = p_id and r.status = 'approved'
  for update of r;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  v_academy := app_private.create_academy_for(v_uid, p_name, p_timezone, p_currency);
  update public.academy_requests set status = 'claimed', academy_id = v_academy where id = v_request.id;
  return v_academy;
end
$$;

-- La création libre n'existe plus : seule la demande approuvée crée un club.
drop function public.create_academy(text, text, text);

-- ---------------------------------------------------------------------------
-- Ticket d'inscription (appelé par le serveur, sans compte : app_server uniquement)
-- ---------------------------------------------------------------------------
-- Le code de club est évalué seul (le serveur distingue « code erroné » d'« aucun code »).
create function app_private.join_code_valid(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.academy_join_codes where code = app_private.normalize_join_code(p_code))
$$;
revoke all on function app_private.join_code_valid(text) from public;
grant execute on function app_private.join_code_valid(text) to app_server;

-- Sans code : invitation de l'équipe en attente pour cette adresse, ou demande de club approuvée pour cette adresse.
create function app_private.signup_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.invitations i where i.email = lower(btrim(p_email)) and i.accepted_at is null and i.expires_at > now())
      or exists (select 1 from public.academy_requests r where r.email = lower(btrim(p_email)) and r.status = 'approved')
$$;
revoke all on function app_private.signup_email_allowed(text) from public;
grant execute on function app_private.signup_email_allowed(text) to app_server;

-- ---------------------------------------------------------------------------
-- Rétention : les demandes ne sont pas conservées indéfiniment (données personnelles du demandeur)
-- ---------------------------------------------------------------------------
create function app_private.purge_academy_requests() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.academy_requests
  where created_at < now() - interval '180 days'
     or (status in ('pending', 'rejected', 'approved') and created_at < now() - interval '90 days');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function app_private.purge_academy_requests() from public;
grant execute on function app_private.purge_academy_requests() to app_server;

revoke all on function public.list_academy_requests() from public, anon;
revoke all on function public.decide_academy_request(uuid, boolean) from public, anon;
revoke all on function public.my_approved_academy_request() from public, anon;
revoke all on function public.claim_academy_request(uuid, text, text, text) from public, anon;
grant execute on function public.list_academy_requests() to authenticated;
grant execute on function public.decide_academy_request(uuid, boolean) to authenticated;
grant execute on function public.my_approved_academy_request() to authenticated;
grant execute on function public.claim_academy_request(uuid, text, text, text) to authenticated;
