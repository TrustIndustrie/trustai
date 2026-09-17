-- ============================================================================
-- TRUST AI — RETOUR ARRIÈRE de la migration 9 (socle logistique)
--
-- Ce fichier est volontairement rangé dans `supabase/rollbacks/` et NON dans
-- `supabase/migrations/` : tout outil parcourant le dossier des migrations
-- l'exécuterait sinon automatiquement et défairait la migration 9. Il ne doit
-- être lancé QUE manuellement, à la demande, dans le SQL Editor.
-- ============================================================================
--
--  ⚠️  AVERTISSEMENT — À LIRE AVANT TOUTE EXÉCUTION  ⚠️
--
--  Ce script SUPPRIME les 13 tables créées par la migration 9 et TOUT ce
--  qu'elles contiennent.
--
--  Il n'est SÛR QUE si les deux conditions suivantes sont réunies :
--     1. les 13 tables sont encore VIDES ;
--     2. aucune phase suivante n'a commencé (aucune lecture du
--        récapitulatif, aucun document déposé, aucun dossier créé).
--
--  DÈS QUE le récapitulatif aura été lu ou qu'un PDF aura été déposé, ces
--  tables contiendront des données réelles : les supprimer les détruirait
--  définitivement. Dans ce cas, NE PAS EXÉCUTER CE SCRIPT — passer par :
--     * une migration corrective (annuler ce qui gêne sans supprimer), OU
--     * un export préalable complet des 13 tables, conservé hors ligne.
--
--  Contrôle à exécuter AVANT ce script (toutes les valeurs doivent être 0) :
--
--     select
--       (select count(*) from public.logistics_lines)              as lignes,
--       (select count(*) from public.delivery_jobs)                as dossiers,
--       (select count(*) from public.delivery_allocations)         as affectations,
--       (select count(*) from public.skara_documents)              as documents,
--       (select count(*) from public.logistics_line_events)        as evenements,
--       (select count(*) from public.skara_document_extractions)   as extractions,
--       (select count(*) from public.skara_document_corrections)   as corrections,
--       (select count(*) from public.match_candidates)             as rapprochements,
--       (select count(*) from public.logistics_anomalies)          as anomalies,
--       (select count(*) from public.recap_sources)                as sources,
--       (select count(*) from public.recap_reads)                  as lectures,
--       (select count(*) from public.sync_events)                  as evenements_sync,
--       (select count(*) from public.sensitive_access_logs)        as journal_acces;
--
--  Ce script ne touche à AUCUNE table existante : commandes, clients,
--  produits, règlements, profils et historique restent intacts. Seules les
--  colonnes ajoutées par la migration 9 sont retirées.
-- ============================================================================

begin;

-- 1. Fonctions RPC et utilitaires de la phase 1.
--    (Les déclencheurs d'immuabilité et de cohérence disparaissent avec les
--    tables ; les fonctions qu'ils utilisent sont retirées ensuite.)
drop function if exists public.get_delivery_job(uuid);
drop function if exists public.allocate_to_delivery_job(uuid, uuid, integer);
drop function if exists public.set_variant_logistics(uuid, jsonb);
drop function if exists public.logistics_summary();

-- 2. Les 13 tables (ordre inverse des dépendances ; cascade pour les
--    contraintes croisées).
drop table if exists public.sensitive_access_logs cascade;
drop table if exists public.sync_events cascade;
drop table if exists public.logistics_anomalies cascade;
drop table if exists public.match_candidates cascade;
drop table if exists public.skara_document_corrections cascade;
drop table if exists public.skara_document_extractions cascade;
drop table if exists public.skara_documents cascade;
drop table if exists public.delivery_allocations cascade;
drop table if exists public.delivery_jobs cascade;
drop table if exists public.logistics_line_events cascade;
drop table if exists public.logistics_lines cascade;
drop table if exists public.recap_reads cascade;
drop table if exists public.recap_sources cascade;

-- 3. Colonnes ajoutées aux tables existantes.
alter table public.product_variants
  drop constraint if exists product_variants_logistics_check;
alter table public.product_variants
  drop column if exists weight_grams,
  drop column if exists packed_length_mm,
  drop column if exists packed_width_mm,
  drop column if exists packed_height_mm,
  drop column if exists volume_cm3,
  drop column if exists package_count,
  drop column if exists fragile,
  drop column if exists requires_installation,
  drop column if exists recommended_handlers,
  drop column if exists handling_notes,
  drop column if exists logistics_verified_at,
  drop column if exists logistics_verified_by;

alter table public.stores
  drop column if exists address_line,
  drop column if exists postal_code,
  drop column if exists latitude,
  drop column if exists longitude,
  drop column if exists opening_notes;

alter table public.warehouses
  drop column if exists address_line,
  drop column if exists postal_code,
  drop column if exists latitude,
  drop column if exists longitude,
  drop column if exists opening_notes;

-- 4. Fonctions utilitaires devenues inutiles (les tables ont disparu).
drop function if exists app.last_correction_int(uuid, text);
drop function if exists app.payload_int(jsonb, text, integer, integer, text);
drop function if exists app.assert_same_org();
drop function if exists app.org_of(text, uuid);
drop function if exists app.forbid_update_delete();

-- 5. Droits rétablis tels qu'ils étaient avant la phase 1.
grant update on public.product_variants to authenticated;
grant execute on function public.create_store_order(jsonb) to authenticated;

-- 6. Contrainte de rôles ramenée aux 7 rôles d'origine.
--    ⚠️ Échoue volontairement si un profil porte déjà un des deux nouveaux
--    rôles : dans ce cas, réattribuer d'abord ces profils à un rôle existant.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in (
    'vendeur','responsable_magasin','achats','logistique','comptabilite',
    'direction','administrateur'
  ));

-- 7. Matrice de permissions d'origine (11 permissions, 7 rôles).
create or replace function app.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'vendeur' then array[
      'creer_commande','encaisser_reglement']
    when 'responsable_magasin' then array[
      'creer_commande','encaisser_reglement','valider_decision',
      'gerer_encaissements','voir_acquisition','produit_hors_catalogue']
    when 'achats' then array[
      'gerer_achats','valider_decision','gerer_catalogue']
    when 'logistique' then array[
      'gerer_logistique']
    when 'comptabilite' then array[
      'gerer_encaissements']
    when 'direction' then array[
      'creer_commande','encaisser_reglement','valider_decision','gerer_achats',
      'gerer_logistique','gerer_encaissements','voir_acquisition',
      'gerer_catalogue','produit_hors_catalogue','voir_tous_magasins']
    when 'administrateur' then array[
      'creer_commande','encaisser_reglement','valider_decision','gerer_achats',
      'gerer_logistique','gerer_encaissements','voir_acquisition',
      'gerer_catalogue','produit_hors_catalogue','voir_tous_magasins','administrer']
    else array[]::text[]
  end
$$;

commit;
