-- ============================================================================
-- RETOUR ARRIÈRE — Migration 18 : DISPONIBILITÉ ET CRÉNEAUX DE LIVRAISON
-- ----------------------------------------------------------------------------
-- À exécuter AVANT le retour arrière de la migration 17, donc en premier :
-- les retours arrière se déroulent dans l'ordre inverse des migrations.
--
-- CE SCRIPT PERD DES DONNÉES, et c'est le seul de la série dans ce cas : la
-- table des créneaux disparaît, donc les dates promises aux clients avec
-- elle. Les étapes des dossiers déjà avancées jusqu'à « créneau confirmé »
-- sont ramenées à « prêt à contacter », faute de créneau pour les justifier.
--
-- Exportez `delivery_slots` avant de l'exécuter si ces dates comptent encore.
-- ============================================================================

begin;

drop function if exists public.decline_delivery_slots(uuid, text);
drop function if exists public.confirm_delivery_slot(uuid, text);
drop function if exists public.propose_delivery_slots(uuid, jsonb, text);
drop function if exists public.authorize_delivery_contact(uuid, text, boolean);
drop function if exists public.get_delivery_readiness(uuid);
drop function if exists public.list_delivery_jobs(jsonb);
drop function if exists app.delivery_readiness(uuid);

-- Les dossiers engagés sur un créneau perdent leur justification : on les
-- ramène à l'étape d'avant plutôt que de les laisser dans un état que plus
-- rien ne documente.
update public.delivery_jobs
   set stage = 'pret_a_contacter'
 where stage in ('contact_en_cours', 'creneau_confirme');

drop table if exists public.delivery_slots;

alter table public.delivery_jobs drop column if exists contact_authorized_partial;
alter table public.delivery_jobs drop column if exists contact_authorization_note;
alter table public.delivery_jobs drop column if exists contact_authorized_by;
alter table public.delivery_jobs drop column if exists contact_authorized_at;

commit;
