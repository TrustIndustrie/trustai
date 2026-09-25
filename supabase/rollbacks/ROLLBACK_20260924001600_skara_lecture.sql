-- ============================================================================
-- RETOUR ARRIÈRE — Migration 16 : LECTURE DES DONNÉES SKARA
-- ----------------------------------------------------------------------------
-- À exécuter AVANT le retour arrière de la migration 15, donc en premier :
-- les retours arrière se déroulent dans l'ordre inverse des migrations.
--
-- Sans danger : cette migration n'a créé que des fonctions de lecture.
-- Aucune donnée n'est perdue, seules les pages de consultation et de
-- contrôle cessent de fonctionner.
-- ============================================================================

begin;

drop function if exists public.list_skara_articles_without_cost(integer);
drop function if exists public.get_skara_monthly_control(date, date);
drop function if exists public.get_skara_invoice(uuid);
drop function if exists public.list_skara_invoices(jsonb);

commit;
