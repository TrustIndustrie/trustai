-- ============================================================================
-- TRUST AI — Migration 6 : SKU en doublon dans les variantes Shopify
-- ----------------------------------------------------------------------------
-- Constat terrain (synchronisation du vrai catalogue Trust Industrie) :
-- Shopify autorise plusieurs variantes d'un même produit à partager le même
-- SKU (SKU recopié ou laissé identique par le marchand). Le miroir TRUST AI
-- doit refléter la boutique telle qu'elle est, pas la refuser.
--
-- La contrainte `unique (product_id, sku)` reste une bonne règle pour le
-- catalogue saisi À LA MAIN : elle est donc conservée, mais uniquement pour
-- les variantes manuelles (sans identifiant Shopify). Les variantes
-- synchronisées depuis Shopify restent dédupliquées par leur identifiant
-- Shopify (index unique product_variants_shopify_id_key, migration 1).
--
-- Aucune donnée n'est modifiée ni supprimée par cette migration.
-- ============================================================================

alter table public.product_variants
  drop constraint product_variants_product_id_sku_key;

create unique index product_variants_manual_sku_key
  on public.product_variants (product_id, sku)
  where shopify_variant_id is null;
