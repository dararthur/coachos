-- Coach OS — 0009 numéro de téléphone des membres (lien de recontact WhatsApp).
--
-- Stocké au format international E.164 (« +33612345678 ») : l'application normalise la saisie (06 12 34 56 78 => +33612345678).
-- Le numéro est une donnée personnelle : effacé à l'anonymisation (déclencheur ci-dessous, qui couvre erase_person et la
-- purge de rétention sans les réécrire) et inclus dans les exports au titre du droit d'accès.

alter table public.people
  add column phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

grant insert (phone), update (phone) on public.people to authenticated;

create function app_private.people_clear_phone_on_anonymize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.anonymized_at is not null then
    new.phone := null;
  end if;
  return new;
end
$$;

create trigger people_clear_phone_on_anonymize before insert or update on public.people
  for each row execute function app_private.people_clear_phone_on_anonymize();

-- Exports (0005) : identiques, avec le téléphone en plus.
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
      'joined_on', p.joined_on, 'external_ref', p.external_ref,
      'adult_attested_at', p.adult_attested_at, 'archived_at', p.archived_at, 'created_at', p.created_at
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_starts_at', s.starts_at, 'class_type', ct.name, 'status', at.status, 'recorded_at', at.recorded_at
      ) order by s.starts_at)
      from public.attendance at
      join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
      join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
      where at.person_id = p.id and at.academy_id = p.academy_id
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
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  perform app_private.write_audit(null, v_uid, 'account.data_exported', 'user', v_uid, '{}'::jsonb);
  return jsonb_build_object(
    'generated_at', now(),
    'profile', (select jsonb_build_object('email', p.email, 'display_name', p.display_name, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'academies', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'role', m.role, 'since', m.created_at))
      from public.academy_memberships m join public.academies a on a.id = m.academy_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    'member_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'academy', a.name, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email, 'phone', p.phone,
        'joined_on', p.joined_on,
        'attendance', coalesce((
          select jsonb_agg(jsonb_build_object('session_starts_at', s.starts_at, 'status', at.status) order by s.starts_at)
          from public.attendance at join public.sessions s on s.id = at.session_id and s.academy_id = at.academy_id
          where at.person_id = p.id and at.academy_id = p.academy_id), '[]'::jsonb)
      ))
      from public.people p join public.academies a on a.id = p.academy_id
      where p.user_id = v_uid
    ), '[]'::jsonb)
  );
end
$$;
