-- Coach OS — 0017 pointage par QR fixe du club, en alternative au QR tournant.
--
-- Deux modes par club (academies.checkin_mode) :
--   'rotating' : un QR éphémère par séance, affiché par le coach (0006) ;
--   'fixed'    : un QR permanent du club, imprimé et affiché dans la salle. Le scan retrouve la séance par l'heure : de
--                `checkin_before_minutes` avant le début à `checkin_after_minutes` après. Si plusieurs séances se chevauchent,
--                l'adhérent choisit ; la réservation reste obligatoire (comme pour le QR tournant).
-- La clé du QR fixe est un secret du club (comme le code d'inscription) : lisible par le staff seulement, régénérable.
-- Elle n'identifie personne : l'identité est toujours celle de la session authentifiée.

alter table public.academies
  add column checkin_mode text not null default 'rotating' check (checkin_mode in ('rotating', 'fixed')),
  add column checkin_before_minutes smallint not null default 45 check (checkin_before_minutes between 0 and 240),
  add column checkin_after_minutes smallint not null default 30 check (checkin_after_minutes between 0 and 240);

create table public.academy_checkin_keys (
  academy_id uuid primary key references public.academies (id) on delete cascade,
  key text not null unique check (key ~ '^[a-f0-9]{24}$'),
  rotated_at timestamptz not null default now()
);
alter table public.academy_checkin_keys enable row level security;
alter table public.academy_checkin_keys force row level security;
create policy academy_checkin_keys_select on public.academy_checkin_keys for select to authenticated
using (app_private.is_staff(academy_id));
revoke all on public.academy_checkin_keys from public, anon, authenticated;
grant select on public.academy_checkin_keys to authenticated;

-- 96 bits aléatoires (gen_random_uuid est cryptographiquement sûr).
create function app_private.new_checkin_key() returns text
language sql volatile set search_path = '' as $$
  select substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 24)
$$;
revoke all on function app_private.new_checkin_key() from public;

create function app_private.academies_issue_checkin_key() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.academy_checkin_keys (academy_id, key) values (new.id, app_private.new_checkin_key());
  return new;
end
$$;
revoke all on function app_private.academies_issue_checkin_key() from public;
create trigger academies_issue_checkin_key after insert on public.academies
for each row execute function app_private.academies_issue_checkin_key();

insert into public.academy_checkin_keys (academy_id, key)
select id, app_private.new_checkin_key() from public.academies;

-- ---------------------------------------------------------------------------
-- Réglages (administrateurs)
-- ---------------------------------------------------------------------------
create function public.set_checkin_settings(p_academy uuid, p_mode text, p_before integer, p_after integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if p_mode not in ('rotating', 'fixed') or p_before not between 0 and 240 or p_after not between 0 and 240 then
    raise exception 'coachos:validation' using errcode = 'P0001';
  end if;
  update public.academies set checkin_mode = p_mode, checkin_before_minutes = p_before, checkin_after_minutes = p_after
  where id = p_academy;
  perform app_private.write_audit(p_academy, v_uid, 'academy.checkin_settings_updated', 'academy', p_academy,
    jsonb_build_object('mode', p_mode, 'before', p_before, 'after', p_after));
end
$$;

-- Nouvelle clé : les QR déjà imprimés cessent immédiatement de fonctionner.
create function public.regenerate_checkin_key(p_academy uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  update public.academy_checkin_keys set key = app_private.new_checkin_key(), rotated_at = now() where academy_id = p_academy;
  perform app_private.write_audit(p_academy, v_uid, 'academy.checkin_key_regenerated', 'academy', p_academy, '{}'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Adhérent : séances atteignables par le QR fixe, puis pointage
-- ---------------------------------------------------------------------------
-- Toute cause d'échec liée à la clé (inconnue, club sans QR fixe, appelant non membre) renvoie la MÊME erreur.
create function app_private.checkin_fixed_candidates(p_key text)
returns table (academy_id uuid, session_id uuid, person_id uuid, class_name text, starts_at timestamptz, ends_at timestamptz, timezone text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy public.academies%rowtype;
  v_person uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select a.* into v_academy from public.academy_checkin_keys k join public.academies a on a.id = k.academy_id
  where k.key = p_key;
  if v_academy.id is null or v_academy.checkin_mode <> 'fixed' or not app_private.is_member(v_academy.id) then
    raise exception 'coachos:checkin_invalid' using errcode = 'P0001';
  end if;
  select p.id into v_person from public.people p
  where p.academy_id = v_academy.id and p.user_id = v_uid and p.archived_at is null and p.anonymized_at is null;
  if v_person is null then
    raise exception 'coachos:checkin_no_profile' using errcode = 'P0001';
  end if;
  return query
    select s.academy_id, s.id, v_person, ct.name, s.starts_at, s.ends_at, v_academy.timezone
    from public.sessions s
    join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
    where s.academy_id = v_academy.id and s.status = 'scheduled'
      and now() >= s.starts_at - make_interval(mins => v_academy.checkin_before_minutes)
      and now() <= s.starts_at + make_interval(mins => v_academy.checkin_after_minutes)
      and not exists (select 1 from public.session_checkins c where c.session_id = s.id and c.validated_at is not null)
    order by s.starts_at;
end
$$;
revoke all on function app_private.checkin_fixed_candidates(text) from public;

create function public.checkin_fixed_peek(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'timezone', (select a.timezone from public.academy_checkin_keys k join public.academies a on a.id = k.academy_id where k.key = p_key),
    'sessions', coalesce(jsonb_agg(jsonb_build_object(
      'session_id', c.session_id, 'class_name', c.class_name, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'booking', (select b.status from public.session_bookings b where b.session_id = c.session_id and b.person_id = c.person_id),
      'status', (select a.status from public.attendance a where a.session_id = c.session_id and a.person_id = c.person_id)
    ) order by (exists (select 1 from public.session_bookings b where b.session_id = c.session_id and b.person_id = c.person_id and b.status = 'booked')) desc, c.starts_at), '[]'::jsonb)
  ) into v_result
  from app_private.checkin_fixed_candidates(p_key) c;
  return v_result;
end
$$;

create function public.checkin_fixed_redeem(p_key text, p_session uuid, p_book boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_booking text;
  v_validated timestamptz;
begin
  select * into c from app_private.checkin_fixed_candidates(p_key) f where f.session_id = p_session;
  if c.session_id is null then
    raise exception 'coachos:checkin_invalid' using errcode = 'P0001';
  end if;
  -- Une validation concurrente de la feuille (verrou partagé sur son état) invalide ce pointage.
  select validated_at into v_validated from public.session_checkins where session_id = p_session for share;
  if v_validated is not null then
    raise exception 'coachos:checkin_invalid' using errcode = 'P0001';
  end if;

  select b.status into v_booking from public.session_bookings b where b.session_id = c.session_id and b.person_id = c.person_id;
  if v_booking is null then
    if exists (select 1 from public.attendance a where a.session_id = c.session_id and a.person_id = c.person_id) then
      return app_private.checkin_record(c.academy_id, c.session_id, c.person_id, c.class_name, c.starts_at);
    end if;
    if not coalesce(p_book, false) then
      raise exception 'coachos:checkin_no_booking' using errcode = 'P0001';
    end if;
    v_booking := app_private.book_person(c.session_id, c.person_id);
  end if;
  if v_booking = 'waitlisted' then
    return jsonb_build_object('result', 'waitlisted', 'class_name', c.class_name, 'starts_at', c.starts_at);
  end if;
  return app_private.checkin_record(c.academy_id, c.session_id, c.person_id, c.class_name, c.starts_at);
end
$$;

revoke all on function public.set_checkin_settings(uuid, text, integer, integer), public.regenerate_checkin_key(uuid),
  public.checkin_fixed_peek(text), public.checkin_fixed_redeem(text, uuid, boolean) from public, anon;
grant execute on function public.set_checkin_settings(uuid, text, integer, integer), public.regenerate_checkin_key(uuid),
  public.checkin_fixed_peek(text), public.checkin_fixed_redeem(text, uuid, boolean) to authenticated;
