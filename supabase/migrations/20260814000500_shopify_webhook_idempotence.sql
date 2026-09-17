-- ===========================================================================
-- TRUST AI — migration 5 : idempotence des webhooks Shopify
--
-- Shopify livre chaque événement avec un identifiant unique
-- (en-tête X-Shopify-Webhook-Id) et peut retenter la livraison du MÊME
-- événement en cas de timeout. L'unicité de webhook_id permet de détecter
-- et d'ignorer proprement ces re-livraisons sans retraiter l'événement.
-- ===========================================================================

alter table public.shopify_webhook_events add column webhook_id text;

create unique index shopify_webhook_events_webhook_id_key
  on public.shopify_webhook_events (webhook_id)
  where webhook_id is not null;
