-- Rôle de sauvegarde de Coach OS. EXEMPLE NON EXÉCUTÉ sur une instance réelle ; à lancer par une personne, en administrateur.
--
-- Pourquoi chaque privilège (voir docs/operations.md §1.2) :
--   * pg_read_all_data (PostgreSQL 14+) : SELECT sur toutes les tables et séquences et USAGE sur tous les schémas (public, auth, app_private,
--     coachos_migrations). Lecture seule : aucun INSERT/UPDATE/DELETE, aucun DDL. Un `pg_dump` complet n'a pas besoin de plus côté droits d'objets.
--   * BYPASSRLS : INDISPENSABLE. Les tables ont la RLS activée et appartiennent à un autre rôle ; sans BYPASSRLS, `pg_dump` (qui force
--     row_security=off) échoue au lieu de produire une copie incomplète, et `--enable-row-security` ne sauvegarderait que les lignes visibles
--     (donc un sous-ensemble silencieux : à ne JAMAIS utiliser). Conséquence assumée : ce rôle voit toutes les données de tous les clubs.
--     La RLS n'est ni désactivée ni modifiée ; le rôle ne peut RIEN écrire.
--   * default_transaction_read_only = on : filet supplémentaire (pg_dump ouvre de toute façon une transaction en lecture seule).
--   * NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION : aucun autre privilège.
--   * CONNECTION LIMIT 2 : une sauvegarde à la fois (plus une marge).
-- Le mot de passe n'est PAS dans ce fichier : le définir avec `\password coachos_backup` dans psql (jamais dans un script versionné).
-- Ce rôle n'est pas géré par le lanceur de migrations : il est propre à chaque serveur.
create role coachos_backup login nosuperuser nocreatedb nocreaterole noreplication bypassrls connection limit 2;
grant pg_read_all_data to coachos_backup;
alter role coachos_backup set default_transaction_read_only = on;
