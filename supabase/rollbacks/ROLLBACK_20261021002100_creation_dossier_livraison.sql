-- ============================================================================
-- RETOUR ARRIÈRE — Migration 21 : CRÉATION D'UN DOSSIER DE LIVRAISON
-- ----------------------------------------------------------------------------
-- À exécuter AVANT le retour arrière de la migration 20, donc en premier :
-- les retours arrière se déroulent dans l'ordre inverse des migrations.
--
-- CE SCRIPT NE PERD AUCUNE DONNÉE. La migration 21 n'a créé ni table ni
-- colonne : elle n'a ajouté que deux fonctions. Les dossiers de livraison
-- déjà créés restent en place, avec leurs affectations, leurs créneaux et
-- leurs passages de tournée.
--
-- CE QU'IL FAUT SAVOIR AVANT DE L'EXÉCUTER : après ce retour arrière, plus
-- rien ne crée de dossier de livraison. La chaîne redevient ce qu'elle était
-- au 20 octobre 2026 — des créneaux, des tournées et des droits de livreur
-- suspendus à une porte qui n'existe pas. Ce n'est pas une panne, c'est
-- l'état antérieur.
-- ============================================================================

begin;

drop function if exists public.create_delivery_job(jsonb);
drop function if exists app.next_delivery_job_reference(uuid);

commit;
