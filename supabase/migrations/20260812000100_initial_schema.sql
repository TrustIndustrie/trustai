-- ===========================================================================
-- TRUST AI — migration 1 : schéma initial
--
-- Conventions :
--  * clés primaires UUID (gen_random_uuid) pour la solidité des relations ;
--  * les références métier lisibles (MAG-HER-2026-0008, FOU-2026-0017,
--    TRA-2026-0022) sont conservées dans des colonnes `reference` uniques ;
--  * tous les montants sont stockés en CENTIMES (integer) pour éviter les
--    erreurs de virgule flottante — cohérent avec src/lib/money.ts ;
--  * chaque table métier porte organization_id + created_at/updated_at ;
--  * les identifiants Shopify sont préparés mais Shopify n'est PAS connecté.
-- ===========================================================================

create extension if not exists pgcrypto;

-- Schéma interne pour les fonctions utilitaires (non exposé par PostgREST).
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organisation (unique aujourd'hui : Trust Industrie — extensible demain)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Dépôts (créés avant les magasins pour la référence store → dépôt)
-- Argenteuil et Aubagne sont des DÉPÔTS : jamais le même identifiant qu'un
-- magasin. « Marseille » n'est qu'un ancien alias documentaire d'Aubagne.
-- ---------------------------------------------------------------------------
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  city text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Magasins (Lisses, Herblay, Aubagne). Herblay est un MAGASIN ; il peut être
-- rattaché logistiquement au dépôt d'Argenteuil via default_warehouse_id,
-- sans jamais fusionner les deux entités.
-- ---------------------------------------------------------------------------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  city text not null,
  aliases text[] not null default '{}',
  default_warehouse_id uuid references public.warehouses(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- Profils employés (liés à auth.users). Le rôle n'est jamais choisi par
-- l'utilisateur lui-même (aucune policy d'update pour soi-même sur role).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  display_name text not null,
  role text not null check (role in (
    'vendeur','responsable_magasin','achats','logistique',
    'comptabilite','direction','administrateur'
  )),
  primary_store_id uuid references public.stores(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Magasins autorisés par profil (memberships).
create table public.user_store_access (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, store_id)
);

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  phone text,
  email text,
  address text,
  postal_code text,
  city text,
  shopify_customer_id text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_shopify_id_key
  on public.customers (organization_id, shopify_customer_id)
  where shopify_customer_id is not null;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  title text not null,
  short_description text,
  category text not null check (category in (
    'canapes','tables','chaises','lits','matelas','fauteuils',
    'decoration','luminaires'
  )),
  image_url text,
  source text not null default 'manuel' check (source in ('shopify','manuel')),
  shopify_product_id text,
  shopify_handle text,
  shopify_updated_at timestamptz,
  last_synced_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_shopify_id_key
  on public.products (organization_id, shopify_product_id)
  where shopify_product_id is not null;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  sku text not null,
  barcode text,
  color text,
  dimensions text,
  price_cents integer not null check (price_cents >= 0),
  shopify_variant_id text,
  shopify_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, sku)
);
create unique index product_variants_shopify_id_key
  on public.product_variants (shopify_variant_id)
  where shopify_variant_id is not null;

-- ---------------------------------------------------------------------------
-- Fournisseurs (aucun identifiant ni mot de passe fournisseur stocké)
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  phone text,
  country text,
  specialties text[] not null default '{}',
  website text,
  order_channel text not null default 'email'
    check (order_channel in ('whatsapp','site','application','email')),
  stock_url text,
  usual_order_day text,
  pickup_days text[] not null default '{}',
  lead_time_days integer check (lead_time_days > 0),
  logistics text not null default 'les_deux'
    check (logistics in ('retrait_trust','livraison_fournisseur','les_deux')),
  active boolean not null default true,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- Association produit/variante ↔ fournisseur (principal + alternatifs).
create table public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  product_id uuid references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  product_name text not null,
  variant_label text,
  supplier_id uuid not null references public.suppliers(id),
  supplier_reference text,
  lead_time_days integer check (lead_time_days > 0),
  priority integer not null default 1 check (priority >= 1),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index product_suppliers_variant_supplier_key
  on public.product_suppliers (variant_id, supplier_id)
  where variant_id is not null;

-- ---------------------------------------------------------------------------
-- Commandes clients
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reference text not null,
  origin text not null check (origin in ('SHOPIFY','MAGASIN')),
  store_id uuid references public.stores(id),
  salesperson_profile_id uuid references public.profiles(id),
  customer_id uuid not null references public.customers(id),
  ordered_at timestamptz not null,
  desired_at timestamptz,
  fulfillment_mode text not null check (fulfillment_mode in (
    'livraison','retrait_magasin','retrait_depot'
  )),
  delivery_status text not null default 'a_planifier' check (delivery_status in (
    'a_planifier','planifiee','en_cours','livree','prete_retrait',
    'retiree','reportee','annulee'
  )),
  fulfillment_location_label text,
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  acquisition_source text check (acquisition_source in (
    'google_naturel','google_ads','instagram','facebook','tiktok',
    'bouche_a_oreille','passage_magasin','ancien_client','autre'
  )),
  status text not null default 'ouverte'
    check (status in ('ouverte','terminee','annulee')),
  notes text,
  shopify_order_id text,
  shopify_order_number text,
  shopify_updated_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference),
  -- Une commande magasin doit avoir un magasin.
  check (origin <> 'MAGASIN' or store_id is not null)
);
create unique index orders_shopify_id_key
  on public.orders (organization_id, shopify_order_id)
  where shopify_order_id is not null;
create index orders_store_idx on public.orders (store_id);
create index orders_ordered_at_idx on public.orders (ordered_at);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  variant_id uuid references public.product_variants(id),
  off_catalog boolean not null default false,
  product_name text not null,
  variant_label text,
  reference text,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  supplier_id uuid references public.suppliers(id),
  alt_supplier_id uuid references public.suppliers(id),
  procurement_status text not null default 'a_verifier' check (procurement_status in (
    'a_verifier','stock_local','a_commander','en_attente_validation','commande',
    'indisponible','relance_due','pret_fournisseur','en_transport','recu_depot','annule'
  )),
  expected_arrival timestamptz,
  destination_warehouse_id uuid references public.warehouses(id),
  supplier_order_id uuid, -- FK ajoutée après création de supplier_orders
  last_reminder_at timestamptz,
  next_reminder_at timestamptz,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_supplier_idx on public.order_lines (supplier_id);
create index order_lines_procurement_idx on public.order_lines (procurement_status);

-- ---------------------------------------------------------------------------
-- Commandes fournisseurs
-- ---------------------------------------------------------------------------
create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reference text not null,
  supplier_id uuid not null references public.suppliers(id),
  status text not null default 'proposition' check (status in (
    'proposition','en_attente_validation','validee','confirmee','annulee'
  )),
  expected_at timestamptz,
  notes text,
  validated_at timestamptz,
  validated_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference)
);

create table public.supplier_order_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null references public.supplier_orders(id) on delete cascade,
  order_line_id uuid references public.order_lines(id),
  product_name text not null,
  variant_label text,
  supplier_reference text,
  quantity integer not null check (quantity > 0),
  unit_cost_cents integer check (unit_cost_cents >= 0),
  created_at timestamptz not null default now()
);
create index supplier_order_lines_so_idx
  on public.supplier_order_lines (supplier_order_id);

alter table public.order_lines
  add constraint order_lines_supplier_order_fkey
  foreign key (supplier_order_id) references public.supplier_orders(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- Logistique : arrivages, articles transportés, étapes
-- ---------------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reference text not null,
  supplier_id uuid references public.suppliers(id),
  warehouse_id uuid references public.warehouses(id),
  origin_label text not null,
  destination_label text not null,
  mode text not null check (mode in (
    'retrait_trust','livraison_fournisseur','affretement'
  )),
  carrier text,
  charter_reference text,
  planned_at timestamptz,
  actual_at timestamptz,
  status text not null default 'a_organiser' check (status in (
    'a_organiser','programme','pret_fournisseur','recupere','en_transit',
    'recu_partiellement','recu','retarde','annule'
  )),
  comments text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference)
);

create table public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  order_line_id uuid references public.order_lines(id),
  product_name text not null,
  variant_label text,
  quantity integer not null check (quantity > 0),
  quantity_received integer not null default 0
    check (quantity_received >= 0 and quantity_received <= quantity),
  created_at timestamptz not null default now()
);
create index shipment_items_shipment_idx on public.shipment_items (shipment_id);

create table public.shipment_legs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  origin_type text not null check (origin_type in ('fournisseur','depot','magasin','client')),
  origin_label text not null,
  destination_type text not null check (destination_type in ('fournisseur','depot','magasin','client')),
  destination_label text not null,
  mode text not null check (mode in ('retrait_trust','livraison_fournisseur','affretement')),
  carrier text,
  charter_reference text,
  planned_at timestamptz,
  actual_at timestamptz,
  status text not null default 'programme' check (status in (
    'a_organiser','programme','pret_fournisseur','recupere','en_transit',
    'recu_partiellement','recu','retarde','annule'
  )),
  created_at timestamptz not null default now(),
  unique (shipment_id, sequence)
);

-- ---------------------------------------------------------------------------
-- Règlements. Montants en centimes, jamais nuls. La règle « strictement
-- positif » est appliquée par la fonction métier add_payment ; la colonne
-- accepte des montants négatifs UNIQUEMENT pour les futures opérations de
-- remboursement/avoir (phase ultérieure, non implémentée ici).
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  order_id uuid not null references public.orders(id),
  amount_cents integer not null check (amount_cents <> 0),
  date timestamptz not null default now(),
  method text not null check (method in (
    'especes','virement','carte_bancaire','paiement_express','cofidis',
    'pnf','alma','floa','avoir','autre'
  )),
  store_id uuid references public.stores(id),
  received_by uuid references public.profiles(id),
  comment text,
  created_at timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create index payments_date_idx on public.payments (date);

-- ---------------------------------------------------------------------------
-- Acquisition marketing
-- ---------------------------------------------------------------------------
create table public.acquisition_journeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  source text not null check (source in (
    'google_naturel','google_ads','instagram','facebook','tiktok',
    'bouche_a_oreille','passage_magasin','ancien_client','autre'
  )),
  landing_page text,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  days_to_conversion integer,
  new_customer boolean,
  created_at timestamptz not null default now(),
  unique (order_id)
);

-- ---------------------------------------------------------------------------
-- Validations humaines
-- ---------------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  type text not null check (type in (
    'commande_fournisseur','changement_fournisseur','annulation_commande',
    'reaffectation_produit','reservation_affretement','message_externe',
    'modification_commande'
  )),
  title text not null,
  description text not null,
  related_order_id uuid references public.orders(id),
  related_supplier_order_id uuid references public.supplier_orders(id),
  related_shipment_id uuid references public.shipments(id),
  requested_by uuid references public.profiles(id),
  financial_impact_cents integer,
  status text not null default 'en_attente'
    check (status in ('en_attente','approuvee','refusee')),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approval_requests_status_idx on public.approval_requests (status);
-- Une seule demande d'annulation ACTIVE par commande.
create unique index approval_requests_one_active_cancellation
  on public.approval_requests (related_order_id)
  where type = 'annulation_commande' and status = 'en_attente';

-- ---------------------------------------------------------------------------
-- Journal d'activité
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles(id),
  actor_label text not null,
  action text not null,
  details text,
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now()
);
create index activity_logs_order_idx on public.activity_logs (order_id);
create index activity_logs_at_idx on public.activity_logs (at);

-- ---------------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations','warehouses','stores','profiles','customers','products',
    'product_variants','suppliers','product_suppliers','orders','order_lines',
    'supplier_orders','shipments','approval_requests'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t);
  end loop;
end;
$$;
