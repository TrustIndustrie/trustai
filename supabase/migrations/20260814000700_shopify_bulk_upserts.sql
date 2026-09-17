-- ============================================================================
-- TRUST AI — Migration 7 : upserts groupés pour la synchronisation Shopify
-- ----------------------------------------------------------------------------
-- Constat terrain : la synchronisation du catalogue écrivait variante par
-- variante (deux requêtes chacune) et dépassait le temps maximal d'exécution
-- serveur sur un vrai catalogue. Le correctif écrit par lots via
-- `insert ... on conflict do update` (upsert PostgREST).
--
-- Or une cible ON CONFLICT ne peut pas s'appuyer sur un index unique PARTIEL
-- sans répéter son prédicat — ce que PostgREST ne fait pas. Les deux index
-- partiels sont donc remplacés par de vraies contraintes uniques : comme les
-- colonnes Shopify sont NULL pour les données saisies à la main et que les
-- contraintes uniques PostgreSQL ignorent les NULL (NULLS DISTINCT), la
-- garantie est STRICTEMENT identique pour les données existantes.
--
-- Aucune donnée n'est modifiée ni supprimée par cette migration.
-- ============================================================================

drop index public.products_shopify_id_key;
alter table public.products
  add constraint products_shopify_id_key
  unique (organization_id, shopify_product_id);

drop index public.product_variants_shopify_id_key;
alter table public.product_variants
  add constraint product_variants_shopify_id_key
  unique (shopify_variant_id);
