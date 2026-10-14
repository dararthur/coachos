-- Coach OS — 0012 inscription autonome : code permanent par club et rattachement par ce code.
--
-- Chaque club possède un code de 8 caractères (alphabet sans ambiguïté), valable indéfiniment pour toutes les inscriptions à venir.
-- Il est transmis tel quel ou via un lien /join/<code>. Un compte dont l'e-mail est confirmé peut rejoindre le club en tant que
-- MEMBRE uniquement (jamais un rôle d'équipe) ; sa fiche est créée automatiquement. Le code est stocké dans une table à part
-- pour ne pas être lisible avec le reste de la ligne du club : seule l'équipe d'encadrement le voit.

create table public.academy_join_codes (
  academy_id uuid primary key references public.academies (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  rotated_at timestamptz not null default now()
);
alter table public.academy_join_codes enable row level security;
create policy academy_join_codes_select on public.academy_join_codes for select to authenticated
  using (app_private.is_staff(academy_id));
grant select on public.academy_join_codes to authenticated;

-- 8 caractères tirés de 32 symboles (A-Z sans I ni O, 2-9) : 40 bits, tirage non biaisé depuis gen_random_uuid().
create function app_private.new_join_code() returns text
language plpgsql set search_path = '' as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hex text;
  v_code text;
begin
  loop
    v_hex := replace(gen_random_uuid()::text, '-', '');
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(c_alphabet, (get_byte(decode(substr(v_hex, 2 * i + 1, 2), 'hex'), 0) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.academy_join_codes where code = v_code);
  end loop;
  return v_code;
end
$$;
revoke all on function app_private.new_join_code() from public;

-- Tout club (existant ou créé plus tard) a un code.
create function app_private.academy_issue_join_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.academy_join_codes (academy_id, code) values (new.id, app_private.new_join_code());
  return new;
end
$$;
revoke all on function app_private.academy_issue_join_code() from public;
create trigger academies_issue_join_code after insert on public.academies
  for each row execute function app_private.academy_issue_join_code();

insert into public.academy_join_codes (academy_id, code)
select a.id, app_private.new_join_code() from public.academies a;

-- Saisie souple : majuscules, sans espaces ni tirets ; retourne null si la forme est invalide.
create function app_private.normalize_join_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case when c ~ '^[A-Z2-9]{8}$' then c end
  from (select upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) as c) s
$$;
revoke all on function app_private.normalize_join_code(text) from public;

-- Nom du club correspondant à un code (affiché avant de confirmer l'inscription), null si le code est inconnu. Réservé aux comptes connectés.
create function public.preview_join_code(p_code text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select a.name into v_name
  from public.academy_join_codes j join public.academies a on a.id = j.academy_id
  where j.code = app_private.normalize_join_code(p_code);
  return v_name;
end
$$;

-- Rejoint le club en tant que membre : crée l'appartenance et la fiche. Idempotent (un compte déjà dans le club garde son rôle).
create function public.join_academy_with_code(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_academy uuid;
  v_confirmed boolean;
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select email_verified into v_confirmed from auth.users where id = v_uid;
  if not coalesce(v_confirmed, false) then
    raise exception 'coachos:email_not_confirmed' using errcode = 'P0001';
  end if;
  select academy_id into v_academy from public.academy_join_codes where code = app_private.normalize_join_code(p_code);
  if v_academy is null then
    raise exception 'coachos:join_code_invalid' using errcode = 'P0001';
  end if;

  insert into public.academy_memberships (academy_id, user_id, role) values (v_academy, v_uid, 'member')
  on conflict (academy_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    perform app_private.ensure_member_record(v_academy, v_uid);
    perform app_private.write_audit(v_academy, v_uid, 'team.joined_by_code', 'academy', v_academy, jsonb_build_object('role', 'member'));
  end if;
  return v_academy;
end
$$;

-- Nouveau code (par exemple après une fuite) : l'ancien cesse immédiatement de fonctionner.
create function public.regenerate_join_code(p_academy uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  v_code := app_private.new_join_code();
  update public.academy_join_codes set code = v_code, rotated_at = now() where academy_id = p_academy;
  perform app_private.write_audit(p_academy, v_uid, 'academy.join_code_regenerated', 'academy', p_academy, '{}'::jsonb);
  return v_code;
end
$$;

revoke all on function public.preview_join_code(text) from public, anon;
revoke all on function public.join_academy_with_code(text) from public, anon;
revoke all on function public.regenerate_join_code(uuid) from public, anon;
grant execute on function public.preview_join_code(text) to authenticated;
grant execute on function public.join_academy_with_code(text) to authenticated;
grant execute on function public.regenerate_join_code(uuid) to authenticated;
