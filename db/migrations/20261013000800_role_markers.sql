-- Coach OS — 0008 marqueurs de propriété des rôles globaux.
--
-- Les rôles PostgreSQL sont communs à TOUT le cluster. Coach OS crée anon, authenticated, app_server et auth_runtime ;
-- sur un cluster partagé avec d'autres applications, un rôle homonyme préexistant serait sinon adopté sans bruit
-- (« create role … if not exists »). Le lanceur de migrations (scripts/migrate.mjs) refuse de démarrer sur une base vierge si l'un
-- de ces noms existe SANS ce marqueur ; il l'accepte avec le marqueur (second environnement Coach OS dans le même cluster).
-- Idempotent.

comment on role anon is 'coachos:managed';
comment on role authenticated is 'coachos:managed';
comment on role app_server is 'coachos:managed';
comment on role auth_runtime is 'coachos:managed';
