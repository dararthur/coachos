-- Coach OS — 0002 membres, disciplines, types de cours, création d'académie.
--
-- Isolation : chaque table porte `academy_id`, et les références entre tables tenant utilisent des
-- clés étrangères COMPOSITES (id, academy_id) afin qu'une ligne de l'académie A ne puisse jamais
-- référencer une ligne de l'académie B, même avec un identifiant forgé.

-- ---------------------------------------------------------------------------
-- Membres (adultes uniquement, aucune donnée de santé)
-- ---------------------------------------------------------------------------
create table public.people (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  joined_on date,
  -- Identifiant dans le logiciel d'origine (import) : sert au contrôle des doublons.
  external_ref text check (external_ref is null or char_length(external_ref) between 1 and 100),
  -- MVP réservé aux adultes : attestation obligatoire de l'administrateur à la création.
  adult_attested_at timestamptz,
  archived_at timestamptz,
  anonymized_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, academy_id),
  check (anonymized_at is not null or adult_attested_at is not null)
);
create unique index people_email_uq on public.people (academy_id, lower(email)) where email is not null;
create unique index people_external_ref_uq on public.people (academy_id, external_ref) where external_ref is not null;
create unique index people_user_uq on public.people (academy_id, user_id) where user_id is not null;
create index people_name_idx on public.people (academy_id, lower(last_name), lower(first_name));
create index people_archived_idx on public.people (academy_id, archived_at);

-- created_by et l'horodatage d'attestation sont fixés par la base, jamais par le client.
create function app_private.set_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  return new;
end
$$;
create function app_private.stamp_person_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  new.adult_attested_at := now();
  return new;
end
$$;
create trigger people_stamp_insert before insert on public.people
  for each row execute function app_private.stamp_person_insert();

create trigger people_updated_at before update on public.people
  for each row execute function app_private.set_updated_at();
create trigger people_academy_immutable before update on public.people
  for each row execute function app_private.forbid_academy_change();

create function app_private.audit_person_lifecycle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    perform app_private.write_audit(new.academy_id, (select auth.uid()), 'member.archived', 'person', new.id, '{}'::jsonb);
  elsif old.archived_at is not null and new.archived_at is null then
    perform app_private.write_audit(new.academy_id, (select auth.uid()), 'member.restored', 'person', new.id, '{}'::jsonb);
  end if;
  return new;
end
$$;
create trigger people_audit_lifecycle after update of archived_at on public.people
  for each row execute function app_private.audit_person_lifecycle();

-- ---------------------------------------------------------------------------
-- Disciplines et types de cours (configurables par académie)
-- ---------------------------------------------------------------------------
create table public.disciplines (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, academy_id)
);
create unique index disciplines_name_uq on public.disciplines (academy_id, lower(btrim(name)));
create trigger disciplines_updated_at before update on public.disciplines
  for each row execute function app_private.set_updated_at();
create trigger disciplines_academy_immutable before update on public.disciplines
  for each row execute function app_private.forbid_academy_change();

create table public.class_types (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  discipline_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  default_duration_minutes integer not null default 60 check (default_duration_minutes between 15 and 360),
  default_capacity integer check (default_capacity is null or default_capacity between 1 and 500),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, academy_id),
  foreign key (discipline_id, academy_id) references public.disciplines (id, academy_id)
);
create unique index class_types_name_uq on public.class_types (academy_id, discipline_id, lower(btrim(name)));
create index class_types_discipline_idx on public.class_types (discipline_id);
create trigger class_types_updated_at before update on public.class_types
  for each row execute function app_private.set_updated_at();
create trigger class_types_academy_immutable before update on public.class_types
  for each row execute function app_private.forbid_academy_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.people enable row level security;
alter table public.disciplines enable row level security;
alter table public.class_types enable row level security;

-- Le staff lit tous les membres de son académie ; un membre ne lit que sa propre fiche.
create policy people_select on public.people for select to authenticated
  using (app_private.is_staff(academy_id) or (user_id = (select auth.uid()) and app_private.is_member(academy_id)));
-- Création : administrateurs, et coachs (pour inscrire un nouvel arrivant sur le tapis).
create policy people_insert on public.people for insert to authenticated
  with check (app_private.is_staff(academy_id) and user_id is null and anonymized_at is null);
create policy people_update on public.people for update to authenticated
  using (app_private.is_admin(academy_id)) with check (app_private.is_admin(academy_id) and anonymized_at is null);
-- Pas de DELETE direct : suppression/anonymisation via erase_person().

create policy disciplines_select on public.disciplines for select to authenticated
  using (app_private.is_member(academy_id));
create policy disciplines_insert on public.disciplines for insert to authenticated
  with check (app_private.is_admin(academy_id));
create policy disciplines_update on public.disciplines for update to authenticated
  using (app_private.is_admin(academy_id)) with check (app_private.is_admin(academy_id));

create policy class_types_select on public.class_types for select to authenticated
  using (app_private.is_member(academy_id));
create policy class_types_insert on public.class_types for insert to authenticated
  with check (app_private.is_admin(academy_id));
create policy class_types_update on public.class_types for update to authenticated
  using (app_private.is_admin(academy_id)) with check (app_private.is_admin(academy_id));

revoke all on public.people, public.disciplines, public.class_types from anon, authenticated, public;
grant select on public.people, public.disciplines, public.class_types to authenticated;
grant insert (academy_id, first_name, last_name, email, joined_on, external_ref)
  on public.people to authenticated;
grant update (first_name, last_name, email, joined_on, archived_at) on public.people to authenticated;
grant insert (academy_id, name) on public.disciplines to authenticated;
grant update (name, archived_at) on public.disciplines to authenticated;
grant insert (academy_id, discipline_id, name, default_duration_minutes, default_capacity)
  on public.class_types to authenticated;
grant update (name, default_duration_minutes, default_capacity, archived_at) on public.class_types to authenticated;

-- ---------------------------------------------------------------------------
-- create_academy : seule voie de création d'un tenant
-- ---------------------------------------------------------------------------
create function public.create_academy(
  p_name text, p_timezone text default 'Europe/Paris', p_currency text default 'EUR'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_discipline uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  -- Garde-fou anti-abus : nombre d'académies détenues par un même compte.
  if (select count(*) from public.academy_memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'coachos:academy_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.academies (name, timezone, currency, created_by)
  values (btrim(p_name), p_timezone, upper(p_currency), v_uid)
  returning id into v_id;

  insert into public.academy_memberships (academy_id, user_id, role) values (v_id, v_uid, 'owner');

  -- Disciplines de départ, modifiables ensuite.
  insert into public.disciplines (academy_id, name) values (v_id, 'Jiu-Jitsu Brésilien') returning id into v_discipline;
  insert into public.class_types (academy_id, discipline_id, name, default_duration_minutes)
  values (v_id, v_discipline, 'JJB — Tous niveaux', 60);
  insert into public.disciplines (academy_id, name) values (v_id, 'Grappling');
  insert into public.disciplines (academy_id, name) values (v_id, 'MMA');

  perform app_private.write_audit(v_id, v_uid, 'academy.created', 'academy', v_id, '{}'::jsonb);
  return v_id;
end
$$;
revoke all on function public.create_academy(text, text, text) from public, anon;
grant execute on function public.create_academy(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_event : journalisation des imports/exports (liste blanche, sans donnée personnelle)
-- ---------------------------------------------------------------------------
create function public.record_event(p_academy uuid, p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('members.imported', 'members.exported', 'attendance.exported') then
    raise exception 'coachos:invalid_action' using errcode = 'P0001';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  -- Seuls des compteurs numériques sont conservés dans l'audit.
  perform app_private.write_audit(
    p_academy, v_uid, p_action, null, null,
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
       from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as t(k, v)
      where jsonb_typeof(v) = 'number' and char_length(k) <= 30)
  );
end
$$;
revoke all on function public.record_event(uuid, text, jsonb) from public, anon;
grant execute on function public.record_event(uuid, text, jsonb) to authenticated;
