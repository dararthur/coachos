-- Coach OS — 0006 pointage des présences par QR code temporaire.
--
-- Réutilise le modèle existant : AUCUN second système de présence. Un pointage est une ligne `attendance`
-- (unique par séance et membre) dont `source = 'qr'`. Le QR ne contient qu'un jeton aléatoire opaque et
-- éphémère ; il n'identifie personne : l'identité vient toujours de la session authentifiée (auth.uid()).
--
--   session_checkins : état du pointage d'une séance (ouvert/fermé) et validation de la feuille d'appel
--   checkin_tokens   : jetons (hachés SHA-256), très courts, révocables — aucun accès direct client

-- ---------------------------------------------------------------------------
-- Origine d'un enregistrement de présence
-- ---------------------------------------------------------------------------
alter table public.attendance
  add column source text not null default 'manual' check (source in ('manual', 'qr'));

-- `source` n'est pas dans les privilèges d'INSERT/UPDATE de `authenticated` : seul checkin_redeem() peut écrire 'qr'.
-- Une correction du coach (changement de statut) redevient 'manual'.
create or replace function app_private.guard_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.recorded_by := (select auth.uid());
  if tg_op = 'INSERT' then
    new.recorded_at := now();
    if exists (select 1 from public.sessions s where s.id = new.session_id and s.status = 'cancelled') then
      raise exception 'coachos:session_cancelled' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.people p
      where p.id = new.person_id and (p.archived_at is not null or p.anonymized_at is not null)
    ) then
      raise exception 'coachos:person_archived' using errcode = 'P0001';
    end if;
  elsif new.session_id is distinct from old.session_id or new.person_id is distinct from old.person_id then
    raise exception 'coachos:attendance_key_immutable' using errcode = 'P0001';
  elsif new.status is distinct from old.status then
    new.source := 'manual';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.session_checkins (
  session_id uuid primary key,
  academy_id uuid not null references public.academies (id) on delete cascade,
  status text not null default 'closed' check (status in ('open', 'closed')),
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz,
  -- Le pointage s'éteint de lui-même à cette échéance, même si le coach oublie de le fermer.
  window_ends_at timestamptz,
  closed_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (session_id, academy_id) references public.sessions (id, academy_id) on delete cascade
);
create trigger session_checkins_updated_at before update on public.session_checkins
  for each row execute function app_private.set_updated_at();
create trigger session_checkins_academy_immutable before update on public.session_checkins
  for each row execute function app_private.forbid_academy_change();

create table public.checkin_tokens (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  session_id uuid not null,
  -- SHA-256 du jeton ; le jeton en clair n'existe que dans le QR affiché au coach.
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (session_id, academy_id) references public.sessions (id, academy_id) on delete cascade
);
create index checkin_tokens_session_idx on public.checkin_tokens (session_id, expires_at);

alter table public.session_checkins enable row level security;
alter table public.checkin_tokens enable row level security;

-- Le staff lit l'état du pointage de son club ; les écritures passent exclusivement par les fonctions ci-dessous.
create policy session_checkins_select on public.session_checkins for select to authenticated
  using (app_private.is_staff(academy_id));
-- checkin_tokens : AUCUNE policy et aucun privilège => illisible et non modifiable par un client.

revoke all on public.session_checkins, public.checkin_tokens from anon, authenticated, public;
grant select on public.session_checkins to authenticated;

-- ---------------------------------------------------------------------------
-- Aides internes
-- ---------------------------------------------------------------------------
-- Séance + droit d'enregistrer les présences ; « introuvable » pour tout non-membre du club (pas d'oracle d'existence).
create function app_private.checkin_authorize(p_session uuid) returns public.sessions
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_session from public.sessions where id = p_session;
  if v_session.id is null or not app_private.is_member(v_session.academy_id) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if not app_private.can_record_attendance(p_session) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return v_session;
end
$$;

create function app_private.checkin_revoke_tokens(p_session uuid) returns void
language sql security definer set search_path = '' as $$
  update public.checkin_tokens set revoked_at = now() where session_id = p_session and revoked_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Coach : ouvrir / fermer le pointage, émettre un jeton, valider la feuille d'appel
-- ---------------------------------------------------------------------------
create function public.checkin_open(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions := app_private.checkin_authorize(p_session);
  v_ends timestamptz;
begin
  if v_session.status <> 'scheduled' then
    raise exception 'coachos:session_cancelled' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.session_checkins where session_id = p_session and validated_at is not null) then
    raise exception 'coachos:roll_validated' using errcode = 'P0001';
  end if;
  if now() < v_session.starts_at - interval '2 hours' then
    raise exception 'coachos:checkin_too_early' using errcode = 'P0001';
  end if;
  if now() > v_session.ends_at + interval '2 hours' then
    raise exception 'coachos:checkin_too_late' using errcode = 'P0001';
  end if;
  v_ends := v_session.ends_at + interval '2 hours';

  insert into public.session_checkins as c (session_id, academy_id, status, opened_by, opened_at, window_ends_at, closed_at)
  values (p_session, v_session.academy_id, 'open', v_uid, now(), v_ends, null)
  on conflict (session_id) do update
    set status = 'open', opened_by = v_uid, opened_at = now(), window_ends_at = v_ends, closed_at = null;

  perform app_private.write_audit(v_session.academy_id, v_uid, 'checkin.opened', 'session', p_session, '{}'::jsonb);
  return jsonb_build_object('status', 'open', 'window_ends_at', v_ends);
end
$$;

create function public.checkin_close(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions := app_private.checkin_authorize(p_session);
begin
  update public.session_checkins set status = 'closed', closed_at = now() where session_id = p_session;
  perform app_private.checkin_revoke_tokens(p_session);
  perform app_private.write_audit(v_session.academy_id, v_uid, 'checkin.closed', 'session', p_session, '{}'::jsonb);
  return jsonb_build_object('status', 'closed');
end
$$;

-- Émet un jeton (haché côté appelant) de durée très courte ; refusé si le pointage n'est pas ouvert.
create function public.checkin_issue_token(p_session uuid, p_token_hash text, p_ttl_seconds integer) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions := app_private.checkin_authorize(p_session);
  v_expires timestamptz;
begin
  if v_session.status <> 'scheduled' then
    raise exception 'coachos:session_cancelled' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.session_checkins
    where session_id = p_session and status = 'open' and window_ends_at > now() and validated_at is null
  ) then
    raise exception 'coachos:checkin_closed' using errcode = 'P0001';
  end if;
  -- Jamais plus d'une fenêtre courte : un jeton photographié ne sert pas longtemps.
  v_expires := least(now() + make_interval(secs => greatest(10, least(coalesce(p_ttl_seconds, 90), 300))),
                     (select window_ends_at from public.session_checkins where session_id = p_session));
  insert into public.checkin_tokens (academy_id, session_id, token_hash, expires_at, created_by)
  values (v_session.academy_id, p_session, p_token_hash, v_expires, v_uid);
  -- Ménage : jetons de cette séance expirés depuis plus d'une heure.
  delete from public.checkin_tokens where session_id = p_session and expires_at < now() - interval '1 hour';
  return v_expires;
end
$$;

-- Valide (ou rouvre) la feuille d'appel. Valider ferme le pointage et révoque les jetons.
create function public.roll_set_validated(p_session uuid, p_validated boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions := app_private.checkin_authorize(p_session);
begin
  if p_validated then
    if v_session.status <> 'scheduled' then
      raise exception 'coachos:session_cancelled' using errcode = 'P0001';
    end if;
    insert into public.session_checkins as c (session_id, academy_id, status, closed_at, validated_at, validated_by)
    values (p_session, v_session.academy_id, 'closed', now(), now(), v_uid)
    on conflict (session_id) do update
      set status = 'closed', closed_at = now(), validated_at = now(), validated_by = v_uid;
    perform app_private.checkin_revoke_tokens(p_session);
    perform app_private.write_audit(v_session.academy_id, v_uid, 'roll.validated', 'session', p_session, '{}'::jsonb);
  else
    update public.session_checkins set validated_at = null, validated_by = null where session_id = p_session;
    perform app_private.write_audit(v_session.academy_id, v_uid, 'roll.reopened', 'session', p_session, '{}'::jsonb);
  end if;
  return jsonb_build_object('validated', p_validated);
end
$$;

-- ---------------------------------------------------------------------------
-- Adhérent : aperçu puis pointage
-- ---------------------------------------------------------------------------
-- Résolution commune. Toute cause d'échec liée au jeton (inconnu, expiré, révoqué, séance close/annulée/validée,
-- club dont l'appelant n'est pas membre) renvoie la MÊME erreur : on ne révèle ni l'existence d'un club ni d'un compte.
create function app_private.checkin_resolve(p_token_hash text, p_lock boolean)
returns table (academy_id uuid, session_id uuid, person_id uuid, class_name text, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  v_session uuid;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;

  select t.academy_id, t.session_id into v_academy, v_session
  from public.checkin_tokens t
  where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > now();
  if v_academy is null or not app_private.is_member(v_academy) then
    raise exception 'coachos:checkin_invalid' using errcode = 'P0001';
  end if;

  -- Verrou partagé sur l'état : une fermeture/validation concurrente attend ou invalide ce pointage.
  if p_lock then
    select true into v_ok from public.session_checkins c
    where c.session_id = v_session and c.status = 'open' and c.window_ends_at > now() and c.validated_at is null
    for share;
  else
    select true into v_ok from public.session_checkins c
    where c.session_id = v_session and c.status = 'open' and c.window_ends_at > now() and c.validated_at is null;
  end if;
  if v_ok is not true or not exists (select 1 from public.sessions s where s.id = v_session and s.status = 'scheduled') then
    raise exception 'coachos:checkin_invalid' using errcode = 'P0001';
  end if;

  -- L'identité est celle de la session authentifiée, jamais un paramètre : on ne peut pointer que pour soi.
  return query
    select s.academy_id, s.id, p.id, ct.name, s.starts_at, s.ends_at
    from public.sessions s
    join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
    join public.people p on p.academy_id = s.academy_id and p.user_id = v_uid
      and p.archived_at is null and p.anonymized_at is null
    where s.id = v_session;
  if not found then
    raise exception 'coachos:checkin_no_profile' using errcode = 'P0001';
  end if;
end
$$;

create function public.checkin_peek(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_status text;
  v_tz text;
begin
  select * into r from app_private.checkin_resolve(p_token_hash, false);
  select a.timezone into v_tz from public.academies a where a.id = r.academy_id;
  select a.status into v_status from public.attendance a where a.session_id = r.session_id and a.person_id = r.person_id;
  return jsonb_build_object(
    'class_name', r.class_name, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'timezone', v_tz,
    'already_recorded', v_status is not null, 'status', v_status
  );
end
$$;

create function public.checkin_redeem(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_id uuid;
  v_status text;
begin
  select * into r from app_private.checkin_resolve(p_token_hash, true);
  -- Atomique : la contrainte unique (session_id, person_id) arbitre les doubles scans et les requêtes concurrentes.
  insert into public.attendance (academy_id, session_id, person_id, status, source)
  values (r.academy_id, r.session_id, r.person_id, 'present', 'qr')
  on conflict (session_id, person_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Déjà enregistré (par QR ou par le coach) : rien n'est écrasé, on le dit honnêtement.
    select a.status into v_status from public.attendance a where a.session_id = r.session_id and a.person_id = r.person_id;
    return jsonb_build_object('result', 'already', 'status', v_status, 'class_name', r.class_name, 'starts_at', r.starts_at);
  end if;
  return jsonb_build_object('result', 'recorded', 'status', 'present', 'class_name', r.class_name, 'starts_at', r.starts_at);
end
$$;

-- ---------------------------------------------------------------------------
-- Privilèges
-- ---------------------------------------------------------------------------
revoke all on function app_private.checkin_authorize(uuid), app_private.checkin_revoke_tokens(uuid),
  app_private.checkin_resolve(text, boolean) from public, anon, authenticated;
revoke all on function public.checkin_open(uuid), public.checkin_close(uuid), public.checkin_issue_token(uuid, text, integer),
  public.roll_set_validated(uuid, boolean), public.checkin_peek(text), public.checkin_redeem(text) from public, anon;
grant execute on function public.checkin_open(uuid), public.checkin_close(uuid), public.checkin_issue_token(uuid, text, integer),
  public.roll_set_validated(uuid, boolean), public.checkin_peek(text), public.checkin_redeem(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rétention : purge des jetons périmés (en plus des règles de 0005)
-- ---------------------------------------------------------------------------
create or replace function app_private.purge_expired_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_anonymized integer;
  v_invitations integer;
  v_audit integer;
  v_rate integer;
  v_tokens integer;
begin
  with target as (
    select p.id, p.academy_id from public.people p
    join public.academies a on a.id = p.academy_id
    where p.archived_at is not null and p.anonymized_at is null
      and p.archived_at < now() - make_interval(months => a.retention_months)
  ), done as (
    update public.people p
    set first_name = 'Membre', last_name = 'anonymisé', email = null, external_ref = null,
        user_id = null, joined_on = null, anonymized_at = now()
    from target t where p.id = t.id and p.academy_id = t.academy_id
    returning p.id, p.academy_id
  ), audit as (
    select app_private.write_audit(academy_id, null, 'member.anonymized_by_retention', 'person', id, '{}'::jsonb)
    from done
  )
  select count(*) into v_anonymized from audit;

  delete from public.invitations
  where (accepted_at is not null and accepted_at < now() - interval '30 days')
     or (accepted_at is null and expires_at < now() - interval '30 days');
  get diagnostics v_invitations = row_count;

  delete from public.audit_events where created_at < now() - interval '24 months';
  get diagnostics v_audit = row_count;

  delete from app_private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  delete from public.checkin_tokens where expires_at < now() - interval '1 day';
  get diagnostics v_tokens = row_count;

  return jsonb_build_object(
    'members_anonymized', v_anonymized, 'invitations_deleted', v_invitations,
    'audit_events_deleted', v_audit, 'rate_limits_deleted', v_rate, 'checkin_tokens_deleted', v_tokens
  );
end
$$;
revoke all on function app_private.purge_expired_data() from public, anon, authenticated;
grant execute on function app_private.purge_expired_data() to app_server;
