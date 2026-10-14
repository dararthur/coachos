-- Lien de partage du club : avant de créer un compte, le visiteur voit le NOM du club pour vérifier que c'est le bon
-- (rien d'autre : ni logo, ni effectif, ni planning). Appelée par le serveur seulement (rôle app_server), après une
-- limitation de débit par adresse IP ou par compte. L'identifiant du club sert au serveur à reconnaître un compte déjà
-- membre ; il n'est pas affiché.
create function app_private.preview_join_code_public(p_code text)
returns table (academy_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name
  from public.academy_join_codes j
  join public.academies a on a.id = j.academy_id
  where j.code = app_private.normalize_join_code(p_code)
$$;
revoke all on function app_private.preview_join_code_public(text) from public;
grant execute on function app_private.preview_join_code_public(text) to app_server;
