-- Un responsable légal peut créer son compte.
--
-- Jusqu'ici, l'inscription sans code de club n'était ouverte qu'aux adresses invitées par un club ou dont la demande de club
-- était approuvée. Le responsable d'un mineur reçoit un lien d'accord par e-mail et la page l'invite à se connecter pour suivre
-- son enfant (« Mes enfants ») : sans compte possible, ce parcours aboutissait à une impasse silencieuse (aucun e-mail envoyé).
--
-- Désormais, l'adresse d'un responsable légal enregistrée par un club (accord en attente ou confirmé, non retiré, enfant non
-- anonymisé) est aussi un « ticket » d'inscription. Le compte créé n'appartient à aucun club : il ne voit un enfant qu'une fois
-- rattaché par le lien d'accord reçu par e-mail (app_private.confirm_guardian_consent), comme avant. L'adresse est confirmée
-- par e-mail avant toute connexion ; la réponse de l'inscription reste identique que l'adresse soit autorisée ou non.

create or replace function app_private.signup_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.invitations i where i.email = lower(btrim(p_email)) and i.accepted_at is null and i.expires_at > now())
      or exists (select 1 from public.academy_requests r where r.email = lower(btrim(p_email)) and r.status = 'approved')
      or exists (
        select 1 from public.guardianships g join public.people p on p.id = g.child_id and p.academy_id = g.academy_id
        where lower(g.guardian_email) = lower(btrim(p_email)) and g.consent_withdrawn_at is null and p.anonymized_at is null
      )
$$;
revoke all on function app_private.signup_email_allowed(text) from public;
grant execute on function app_private.signup_email_allowed(text) to app_server;
