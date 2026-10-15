-- Coach OS — 0024 adhérents mineurs.
--
-- Jusqu'ici la fiche exigeait une attestation de majorité. Un mineur est désormais admis, à ces conditions :
--   * sa date de naissance est enregistrée (seulement tant qu'il est mineur : elle est effacée à la majorité) ;
--   * un responsable légal est rattaché à sa fiche (public.guardianships) et confirme son accord par un lien reçu par e-mail ;
--   * pas de compte propre (la création de fiche par le membre lui-même reste réservée aux majeurs) ;
--   * classement et photo restent désactivés tant que le responsable ne les a pas activés lui-même.
-- Le jeton du lien n'est jamais stocké en clair (empreinte SHA-256 calculée par le serveur).

alter table public.people add column birth_date date check (birth_date is null or birth_date between date '1900-01-01' and current_date);

create function app_private.is_minor(p_birth date) returns boolean
language sql stable set search_path = '' as $$
  select p_birth is not null and p_birth > (current_date - interval '18 years')::date
$$;

-- Une fiche de mineur n'a pas d'attestation de majorité : la date de naissance la remplace.
alter table public.people drop constraint people_adult_attested_check;
alter table public.people add constraint people_adult_attested_check
  check (anonymized_at is not null or adult_attested_at is not null or user_id is not null or archived_at is not null or birth_date is not null);

create or replace function app_private.stamp_person_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  if new.user_id is not null then
    -- Fiche créée par le membre lui-même : il atteste lui-même sa majorité, aucune date de naissance.
    new.adult_attested_at := null;
    new.birth_date := null;
  elsif app_private.is_minor(new.birth_date) then
    new.adult_attested_at := null;
  else
    -- Majeur saisi par le staff : la date de naissance n'est pas conservée (minimisation).
    new.adult_attested_at := now();
    new.birth_date := null;
  end if;
  return new;
end
$$;

grant insert (birth_date) on public.people to authenticated;

-- ---------------------------------------------------------------------------
-- Responsable légal
-- ---------------------------------------------------------------------------
create table public.guardianships (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  child_id uuid not null,
  guardian_name text not null check (char_length(btrim(guardian_name)) between 1 and 160),
  guardian_email text not null check (char_length(guardian_email) <= 254 and guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  guardian_phone text check (guardian_phone is null or guardian_phone ~ '^\+[1-9][0-9]{7,14}$'),
  guardian_user_id uuid references auth.users (id) on delete set null,
  consent_token_hash text unique check (consent_token_hash is null or consent_token_hash ~ '^[0-9a-f]{64}$'),
  consent_expires_at timestamptz,
  consent_requested_at timestamptz not null default now(),
  consent_confirmed_at timestamptz,
  consent_withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, academy_id),
  unique (child_id),
  foreign key (child_id, academy_id) references public.people (id, academy_id) on delete cascade
);
create index guardianships_academy_idx on public.guardianships (academy_id);
create index guardianships_user_idx on public.guardianships (guardian_user_id) where guardian_user_id is not null;

alter table public.guardianships enable row level security;
alter table public.guardianships force row level security;
-- Lecture : le staff du club et le responsable lié. Écriture : uniquement par les fonctions ci-dessous.
create policy guardianships_select on public.guardianships for select to authenticated
  using (app_private.is_staff(academy_id) or guardian_user_id = (select auth.uid()));
revoke all on public.guardianships from public, anon, authenticated;
grant select (id, academy_id, child_id, guardian_name, guardian_email, guardian_phone, consent_requested_at, consent_confirmed_at,
              consent_withdrawn_at, created_at) on public.guardianships to authenticated;

-- Pas d'enfant sans responsable : contrôle différé, à la fin de la transaction.
create function app_private.require_guardian() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.birth_date is not null and new.user_id is null and new.anonymized_at is null and new.archived_at is null
     and app_private.is_minor(new.birth_date)
     and not exists (select 1 from public.guardianships g where g.child_id = new.id) then
    raise exception 'coachos:guardian_required' using errcode = 'P0001';
  end if;
  return null;
end
$$;
revoke all on function app_private.require_guardian() from public;
create constraint trigger people_require_guardian after insert on public.people
  deferrable initially deferred for each row execute function app_private.require_guardian();

-- Création d'un mineur par le staff : fiche + responsable + demande de consentement, en une opération.
create function public.create_minor_member(
  p_academy uuid, p_first_name text, p_last_name text, p_birth_date date, p_joined_on date, p_external_ref text,
  p_guardian_name text, p_guardian_email text, p_guardian_phone text, p_token_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_staff(p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if not app_private.is_minor(p_birth_date) then
    raise exception 'coachos:not_minor' using errcode = 'P0001';
  end if;
  insert into public.people (academy_id, first_name, last_name, birth_date, joined_on, external_ref)
  values (p_academy, p_first_name, p_last_name, p_birth_date, p_joined_on, p_external_ref)
  returning id into v_id;
  insert into public.guardianships (academy_id, child_id, guardian_name, guardian_email, guardian_phone, consent_token_hash, consent_expires_at)
  values (p_academy, v_id, p_guardian_name, p_guardian_email, p_guardian_phone, p_token_hash, now() + interval '14 days');
  perform app_private.write_audit(p_academy, v_uid, 'member.minor_created', 'person', v_id, '{}'::jsonb);
  return v_id;
end
$$;

-- Nouvel envoi du lien (jeton précédent invalidé) ; renvoie l'adresse du responsable.
create function public.renew_guardian_consent(p_child uuid, p_token_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child;
  if not found or not app_private.is_staff(v_g.academy_id) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  update public.guardianships
  set consent_token_hash = p_token_hash, consent_expires_at = now() + interval '14 days', consent_requested_at = now(),
      consent_confirmed_at = null, consent_withdrawn_at = null
  where id = v_g.id;
  perform app_private.write_audit(v_g.academy_id, v_uid, 'member.guardian_consent_requested', 'person', p_child, '{}'::jsonb);
  return v_g.guardian_email;
end
$$;

-- Le staff corrige le responsable (adresse erronée) ; un autre e-mail délie le compte et exige un nouveau lien.
create function public.update_guardian(p_child uuid, p_name text, p_email text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.guardianships where child_id = p_child;
  if v_academy is null or not app_private.is_staff(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  update public.guardianships set
    guardian_name = p_name, guardian_email = p_email, guardian_phone = p_phone,
    guardian_user_id = case when guardian_email = p_email then guardian_user_id else null end,
    consent_confirmed_at = case when guardian_email = p_email then consent_confirmed_at else null end
  where child_id = p_child;
  perform app_private.write_audit(v_academy, v_uid, 'member.guardian_updated', 'person', p_child, '{}'::jsonb);
end
$$;

-- Page publique du lien : appelée par le serveur seulement (rôle app_server), après limitation de débit.
-- Confirme l'accord (une seule fois) et, si un compte est connecté, le rattache comme responsable (jamais écrasé).
create function app_private.confirm_guardian_consent(p_token_hash text, p_user uuid)
returns table (child_first_name text, academy_name text, state text)
language plpgsql security definer set search_path = '' as $$
declare
  v_g public.guardianships%rowtype;
  v_state text;
begin
  select * into v_g from public.guardianships where consent_token_hash = p_token_hash for update;
  if not found or v_g.consent_expires_at < now() or v_g.consent_withdrawn_at is not null then
    return query select null::text, null::text, 'invalid'::text;
    return;
  end if;
  v_state := case when v_g.consent_confirmed_at is null then 'confirmed' else 'already' end;
  if v_g.consent_confirmed_at is null then
    update public.guardianships set consent_confirmed_at = now() where id = v_g.id;
    perform app_private.write_audit(v_g.academy_id, null, 'member.guardian_consent_confirmed', 'person', v_g.child_id, '{}'::jsonb);
  end if;
  if p_user is not null and v_g.guardian_user_id is null then
    update public.guardianships set guardian_user_id = p_user where id = v_g.id;
  end if;
  return query
    select p.first_name, a.name, v_state
    from public.people p join public.academies a on a.id = p.academy_id
    where p.id = v_g.child_id;
end
$$;
revoke all on function app_private.confirm_guardian_consent(text, uuid) from public;
grant execute on function app_private.confirm_guardian_consent(text, uuid) to app_server;

-- Retrait de l'accord par le responsable lié ou par un administrateur : la fiche est archivée, classement et photo supprimés.
create function public.withdraw_guardian_consent(p_child uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child;
  if not found or not (v_g.guardian_user_id = v_uid or app_private.is_admin(v_g.academy_id)) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  update public.guardianships set consent_withdrawn_at = now(), consent_token_hash = null where id = v_g.id;
  update public.people set ranking_opt_in = false, archived_at = coalesce(archived_at, now())
  where id = p_child and academy_id = v_g.academy_id;
  delete from public.person_photos where person_id = p_child and academy_id = v_g.academy_id;
  perform app_private.write_audit(v_g.academy_id, v_uid, 'member.guardian_consent_withdrawn', 'person', p_child, '{}'::jsonb);
end
$$;

-- Espace du responsable : ses enfants (aucune autre donnée du club).
create function public.my_children()
returns table (child_id uuid, academy_id uuid, academy_name text, first_name text, last_name text, ranking_opt_in boolean,
               consent_confirmed_at timestamptz, consent_withdrawn_at timestamptz, last_attended_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.academy_id, a.name, p.first_name, p.last_name, p.ranking_opt_in, g.consent_confirmed_at, g.consent_withdrawn_at,
         (select max(s.starts_at) from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id and at.status in ('present', 'late'))
  from public.guardianships g
  join public.people p on p.id = g.child_id and p.academy_id = g.academy_id
  join public.academies a on a.id = g.academy_id
  where g.guardian_user_id = (select auth.uid()) and p.anonymized_at is null
  order by p.first_name
$$;

-- Le responsable active ou coupe l'affichage de son enfant au classement (et de sa photo, si elle existe) : jamais par défaut.
create function public.set_child_ranking_visibility(p_child uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_g public.guardianships%rowtype;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.guardianships where child_id = p_child and guardian_user_id = v_uid;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_g.consent_confirmed_at is null or v_g.consent_withdrawn_at is not null then
    raise exception 'coachos:consent_required' using errcode = 'P0001';
  end if;
  update public.people set ranking_opt_in = coalesce(p_visible, false)
  where id = p_child and academy_id = v_g.academy_id and anonymized_at is null and archived_at is null;
  perform app_private.write_audit(v_g.academy_id, v_uid, 'member.ranking_visibility', 'person', p_child,
    jsonb_build_object('visible', coalesce(p_visible, false), 'by', 'guardian'));
end
$$;

-- Un mineur n'apparaît au classement qu'avec l'accord confirmé de son responsable.
create function app_private.minor_ranking_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ranking_opt_in and app_private.is_minor(new.birth_date)
     and not exists (select 1 from public.guardianships g where g.child_id = new.id and g.consent_confirmed_at is not null and g.consent_withdrawn_at is null) then
    new.ranking_opt_in := false;
  end if;
  return new;
end
$$;
create trigger people_minor_ranking_guard before insert or update of ranking_opt_in on public.people
  for each row execute function app_private.minor_ranking_guard();

-- Effacement : le responsable disparaît avec la fiche, la date de naissance aussi.
create or replace function app_private.people_clear_phone_on_anonymize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.anonymized_at is not null then
    new.phone := null;
    new.ranking_opt_in := false;
    new.belt := null;
    new.belt_stripes := 0;
    new.avatar_style := 'neutral';
    new.birth_date := null;
  end if;
  return new;
end
$$;
create function app_private.drop_guardian_on_anonymize() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.guardianships where child_id = new.id and academy_id = new.academy_id;
  return null;
end
$$;
revoke all on function app_private.drop_guardian_on_anonymize() from public;
create trigger people_drop_guardian after update of anonymized_at on public.people
  for each row when (new.anonymized_at is not null) execute function app_private.drop_guardian_on_anonymize();

-- Majorité atteinte : la fiche devient celle d'un adulte ; date de naissance et responsable sont effacés. Appelée par la purge quotidienne.
create function app_private.graduate_minors() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with done as (
    update public.people set adult_attested_at = now(), birth_date = null
    where birth_date is not null and anonymized_at is null and not app_private.is_minor(birth_date)
    returning id, academy_id
  ), gone as (
    delete from public.guardianships g using done d where g.child_id = d.id and g.academy_id = d.academy_id
    returning g.id
  )
  select count(*) into v_n from done;
  return v_n;
end
$$;
revoke all on function app_private.graduate_minors() from public;
grant execute on function app_private.graduate_minors() to app_server;

-- Droits d'accès (art. 15) : la date de naissance et le responsable figurent dans les exports.
create or replace function public.export_person_data(p_person uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.people where id = p_person;
  if v_academy is null or not app_private.is_admin(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'academy', (select a.name from public.academies a where a.id = v_academy),
    'person', jsonb_build_object(
      'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
      'belt', p.belt, 'belt_stripes', p.belt_stripes, 'avatar_style', p.avatar_style, 'ranking_opt_in', p.ranking_opt_in,
      'joined_on', p.joined_on, 'external_ref', p.external_ref,
      'adult_attested_at', p.adult_attested_at, 'birth_date', p.birth_date, 'archived_at', p.archived_at, 'created_at', p.created_at,
      'has_account', p.user_id is not null
    ),
    'guardian', (
      select jsonb_build_object('name', g.guardian_name, 'email', g.guardian_email, 'phone', g.guardian_phone,
                                'consent_requested_at', g.consent_requested_at, 'consent_confirmed_at', g.consent_confirmed_at,
                                'consent_withdrawn_at', g.consent_withdrawn_at, 'has_account', g.guardian_user_id is not null)
      from public.guardianships g where g.child_id = p.id and g.academy_id = p.academy_id
    ),
    'photo', (
      select jsonb_build_object('content_type', ph.content_type, 'updated_at', ph.updated_at,
                                'data_base64', translate(encode(ph.data, 'base64'), E'\n', ''))
      from public.person_photos ph where ph.person_id = p.id and ph.academy_id = p.academy_id
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', at.status, 'recorded_at', at.recorded_at
      ) order by s.starts_at)
      from public.attendance at
      join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where at.person_id = p.id and at.academy_id = p.academy_id
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', b.status, 'booked_at', b.created_at
      ) order by s.starts_at)
      from public.session_bookings b
      join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where b.person_id = p.id and b.academy_id = p.academy_id
    ), '[]'::jsonb)
  ) into v_result
  from public.people p where p.id = p_person;

  perform app_private.write_audit(v_academy, v_uid, 'member.data_exported', 'person', p_person, '{}'::jsonb);
  return v_result;
end
$$;

create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select email into v_email from auth.users where id = v_uid;
  perform app_private.write_audit(null, v_uid, 'account.data_exported', 'user', v_uid, '{}'::jsonb);
  return jsonb_build_object(
    'generated_at', now(),
    'profile', (select jsonb_build_object('email', p.email, 'display_name', p.display_name, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'last_refreshed_at', s.updated_at,
                                          'expires_at', s.expires_at, 'user_agent', s.user_agent) order by s.created_at)
      from auth.sessions s where s.user_id = v_uid
    ), '[]'::jsonb),
    'academies', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'role', m.role, 'since', m.created_at))
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    -- Demandes faites avec l'adresse du compte (ce compte l'a confirmée, sans quoi la connexion est refusée).
    'club_requests', coalesce((
      select jsonb_agg(jsonb_build_object('club_name', r.name, 'contact_name', r.contact_name, 'email', r.email,
                                          'note', r.note, 'status', r.status, 'created_at', r.created_at,
                                          'decided_at', r.decided_at) order by r.created_at)
      from public.academy_requests r where r.email = v_email
    ), '[]'::jsonb),
    'member_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
        'belt', p.belt, 'belt_stripes', p.belt_stripes, 'avatar_style', p.avatar_style, 'ranking_opt_in', p.ranking_opt_in,
        'joined_on', p.joined_on,
        'photo', (
          select jsonb_build_object('content_type', ph.content_type, 'updated_at', ph.updated_at,
                                    'data_base64', translate(encode(ph.data, 'base64'), E'\n', ''))
          from public.person_photos ph where ph.person_id = p.id and ph.academy_id = p.academy_id
        ),
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb),
        'bookings', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', b.status) order by s.starts_at)
          from public.session_bookings b join public.sessions s on s.id = b.session_id and s.academy_id = b.academy_id
          where b.person_id = p.id and b.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.people p join public.academies a on a.id = p.academy_id
      where p.user_id = v_uid
    ), '[]'::jsonb),
    -- Enfants dont ce compte est le responsable légal.
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'birth_date', p.birth_date,
        'ranking_opt_in', p.ranking_opt_in, 'consent_confirmed_at', g.consent_confirmed_at,
        'consent_withdrawn_at', g.consent_withdrawn_at,
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.guardianships g
      join public.people p on p.id = g.child_id and p.academy_id = g.academy_id
      join public.academies a on a.id = g.academy_id
      where g.guardian_user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.create_minor_member(uuid, text, text, date, date, text, text, text, text, text) from public, anon;
revoke all on function public.renew_guardian_consent(uuid, text) from public, anon;
revoke all on function public.update_guardian(uuid, text, text, text) from public, anon;
revoke all on function public.withdraw_guardian_consent(uuid) from public, anon;
revoke all on function public.my_children() from public, anon;
revoke all on function public.set_child_ranking_visibility(uuid, boolean) from public, anon;
revoke all on function public.export_person_data(uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.create_minor_member(uuid, text, text, date, date, text, text, text, text, text) to authenticated;
grant execute on function public.renew_guardian_consent(uuid, text) to authenticated;
grant execute on function public.update_guardian(uuid, text, text, text) to authenticated;
grant execute on function public.withdraw_guardian_consent(uuid) to authenticated;
grant execute on function public.my_children() to authenticated;
grant execute on function public.set_child_ranking_visibility(uuid, boolean) to authenticated;
grant execute on function public.export_person_data(uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
