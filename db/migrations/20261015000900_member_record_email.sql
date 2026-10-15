-- La fiche créée automatiquement à l'arrivée d'un compte dans un club reprend l'e-mail du compte : sans cela, le coach voyait un champ vide
-- alors que le membre s'est inscrit avec cette adresse. Si une autre fiche du club porte déjà cette adresse (import, saisie manuelle),
-- on ne la copie pas : l'index unique (club, e-mail) interdit les doublons. Les fiches d'enfants (avec date de naissance) ne sont pas touchées.
create or replace function app_private.ensure_member_record(p_academy uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_first text;
  v_last text;
  v_email text;
begin
  select id into v_id from public.people where academy_id = p_academy and user_id = p_user;
  if v_id is not null then
    return v_id;
  end if;
  select btrim(coalesce(nullif(btrim(pr.display_name), ''), split_part(coalesce(pr.email, ''), '@', 1))), nullif(btrim(pr.email), '')
    into v_name, v_email
  from public.profiles pr where pr.id = p_user;
  v_name := left(coalesce(nullif(v_name, ''), 'Membre'), 160);
  v_first := left(split_part(v_name, ' ', 1), 80);
  v_last := left(btrim(substr(v_name, length(v_first) + 1)), 80);
  if v_last = '' then
    v_last := '·';
  end if;
  if v_email is not null and exists (select 1 from public.people o where o.academy_id = p_academy and lower(o.email) = lower(v_email)) then
    v_email := null;
  end if;
  insert into public.people (academy_id, first_name, last_name, email, user_id, joined_on)
  values (p_academy, v_first, v_last, v_email, p_user, current_date)
  returning id into v_id;
  return v_id;
end
$$;

-- Rattrapage : fiches déjà créées sans e-mail (adultes, compte lié), sauf si l'adresse est déjà portée par une autre fiche du club.
update public.people p
set email = pr.email
from public.profiles pr
where p.user_id = pr.id and p.email is null and p.birth_date is null and p.anonymized_at is null and nullif(btrim(pr.email), '') is not null
  and not exists (select 1 from public.people o where o.academy_id = p.academy_id and o.id <> p.id and lower(o.email) = lower(pr.email));
