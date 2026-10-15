-- Page publique du lien de consentement (0024) : lecture SANS effet. Les messageries et antivirus ouvrent souvent les liens reçus
-- par e-mail : la confirmation ne doit jamais se faire à l'ouverture de la page, mais par un geste explicite du responsable.
create function app_private.preview_guardian_consent(p_token_hash text)
returns table (child_first_name text, academy_name text, state text)
language sql stable security definer set search_path = '' as $$
  select p.first_name, a.name, case when g.consent_confirmed_at is null then 'pending' else 'already' end
  from public.guardianships g
  join public.people p on p.id = g.child_id and p.academy_id = g.academy_id
  join public.academies a on a.id = g.academy_id
  where g.consent_token_hash = p_token_hash and g.consent_expires_at >= now() and g.consent_withdrawn_at is null
$$;
revoke all on function app_private.preview_guardian_consent(text) from public;
grant execute on function app_private.preview_guardian_consent(text) to app_server;
