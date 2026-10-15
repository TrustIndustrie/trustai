-- ===========================================================================
-- TRUST AI — migration 4 : intégration Shopify (phase 3)
--
-- Prépare la réception AUTOMATIQUE des commandes et produits Shopify via
-- webhooks (orders/create, orders/updated, products/create, products/update).
-- Les webhooks sont traités par une route serveur Next.js qui vérifie la
-- signature HMAC puis écrit ici avec la clé serveur — jamais côté navigateur.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Moyen de paiement « shopify » : encaissement en ligne reçu via webhook.
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check (method in (
  'especes','virement','carte_bancaire','paiement_express','cofidis',
  'pnf','alma','floa','avoir','shopify','autre'
));

-- ---------------------------------------------------------------------------
-- Identifiant de ligne Shopify : permet des mises à jour idempotentes des
-- lignes de commande SANS écraser le suivi d'approvisionnement saisi par
-- l'équipe (statut, fournisseur, dépôt restent intacts lors d'un
-- orders/updated).
-- ---------------------------------------------------------------------------
alter table public.order_lines add column shopify_line_id text;
create unique index order_lines_shopify_line_id_key
  on public.order_lines (shopify_line_id)
  where shopify_line_id is not null;

-- ---------------------------------------------------------------------------
-- Journal des webhooks reçus : traçabilité, idempotence et débogage.
-- Écrit uniquement par la route serveur (clé serveur, contourne la RLS) ;
-- lisible uniquement par les administrateurs.
-- ---------------------------------------------------------------------------
create table public.shopify_webhook_events (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  shopify_id text,
  payload jsonb not null,
  status text not null default 'recu'
    check (status in ('recu','traite','erreur','ignore')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index shopify_webhook_events_topic_idx
  on public.shopify_webhook_events (topic, received_at desc);

alter table public.shopify_webhook_events enable row level security;

create policy "webhook events readable by admins"
  on public.shopify_webhook_events for select to authenticated
  using (app.has_permission('administrer'));
