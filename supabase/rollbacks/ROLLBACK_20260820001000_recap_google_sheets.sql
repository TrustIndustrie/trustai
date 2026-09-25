-- ============================================================================
-- TRUST AI — RETOUR ARRIÈRE de la migration 10 (récapitulatif Google Sheets)
--
-- Rangé dans `supabase/rollbacks/` et NON dans `supabase/migrations/` : tout
-- outil parcourant le dossier des migrations l'exécuterait sinon
-- automatiquement. À lancer UNIQUEMENT à la demande, dans le SQL Editor.
-- ============================================================================
--
--  ⚠️  AVERTISSEMENT — À LIRE AVANT TOUTE EXÉCUTION  ⚠️
--
--  Ce script retire les fonctions de lecture du récapitulatif et les DEUX
--  colonnes ajoutées à `logistics_lines` :
--     * `missing_since`  (ligne disparue du fichier) ;
--     * `last_read_id`   (dernière lecture ayant vu la ligne).
--
--  Il ne SUPPRIME AUCUNE LIGNE : les lignes logistiques déjà importées, leur
--  historique, leurs anomalies et les lectures enregistrées restent en place.
--  Seules les deux colonnes ci-dessus, et l'information qu'elles portaient,
--  sont perdues.
--
--  Contrôle à exécuter AVANT (pour savoir ce que l'on perd) :
--
--     select
--       (select count(*) from public.logistics_lines
--         where missing_since is not null)  as lignes_signalees_absentes,
--       (select count(*) from public.recap_reads)     as lectures,
--       (select count(*) from public.recap_sources)   as sources;
--
--  Pour tout supprimer (tables comprises), c'est l'autre fichier qu'il faut
--  exécuter ENSUITE : ROLLBACK_20260819000900_socle_logistique.sql.
-- ============================================================================

begin;

-- 1. Fonctions publiques de la phase 2.
drop function if exists public.get_logistics_line(uuid);
drop function if exists public.list_logistics_lines(
  text, text, text, uuid, boolean, integer, integer);
drop function if exists public.sync_recap_rows(uuid, jsonb, text);
drop function if exists public.upsert_recap_source(jsonb);
drop function if exists public.get_recap_source();

-- 2. Colonnes ajoutées à `logistics_lines` (les données des colonnes
--    d'origine ne sont pas touchées).
alter table if exists public.logistics_lines
  drop column if exists missing_since,
  drop column if exists last_read_id;

commit;

-- ---------------------------------------------------------------------------
-- Contrôle après exécution (les cinq fonctions doivent avoir disparu) :
--
--   select count(*) as fonctions_phase_2
--   from information_schema.routines
--   where routine_schema = 'public'
--     and routine_name in ('get_recap_source','upsert_recap_source',
--                          'sync_recap_rows','list_logistics_lines',
--                          'get_logistics_line');
--   -- attendu : 0
-- ---------------------------------------------------------------------------
