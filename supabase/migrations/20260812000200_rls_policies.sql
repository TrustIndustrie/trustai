-- ===========================================================================
-- TRUST AI — migration 2 : fonctions d'autorisation + Row Level Security
--
-- Principes :
--  * RLS activée sur TOUTES les tables métier du schéma public ;
--  * par défaut, un utilisateur non authentifié ne lit ni ne modifie rien ;
--  * un profil désactivé perd tout accès ;
--  * chacun est limité à son organisation ;
--  * les rôles magasin sont limités à leurs magasins autorisés ;
--  * les écritures métier passent par les fonctions RPC de la migration 3
--    (security definer) — les tables n'exposent que la lecture, plus
--    quelques écritures de référentiel réservées aux rôles autorisés.
--    Masquer un bouton n'est jamais la sécurité : c'est PostgreSQL qui tranche.
--
-- Les fonctions d'aide sont SECURITY DEFINER avec search_path épinglé pour
-- éviter les récursions de policies sur profiles / user_store_access, et
-- leurs droits d'exécution sont restreints au rôle authenticated.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fonctions d'aide (schéma app, non exposé par PostgREST)
-- ---------------------------------------------------------------------------

-- Profil actif de l'utilisateur connecté (null sinon).
create or replace function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function app.current_role_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

-- Matrice de permissions : MIROIR de ROLE_PERMISSIONS dans
-- src/lib/types.ts. Toute évolution doit être reportée des deux côtés.
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

create or replace function app.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_permission = any (app.role_permissions(app.current_role_name())),
    false
  )
$$;

-- Accès à un magasin : permission globale ou magasin explicitement autorisé.
create or replace function app.can_access_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.has_permission('voir_tous_magasins')
    or exists (
      select 1 from public.user_store_access usa
      where usa.profile_id = auth.uid() and usa.store_id = p_store_id
    )
$$;

-- Accès à un dépôt : rôles transverses (logistique, achats) ou vision globale.
create or replace function app.can_access_warehouse(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.has_permission('voir_tous_magasins')
    or app.has_permission('gerer_logistique')
    or app.has_permission('gerer_achats')
    or exists (
      select 1
      from public.stores s
      join public.user_store_access usa on usa.store_id = s.id
      where usa.profile_id = auth.uid()
        and s.default_warehouse_id = p_warehouse_id
    )
$$;

-- Lecture d'une commande : vision globale, rôles transverses (achats,
-- logistique, comptabilité — lecture nécessaire à leur domaine), sinon
-- accès au magasin de la commande. Les commandes Shopify (sans magasin)
-- sont visibles des rôles transverses et de la vision globale.
create or replace function app.can_read_order(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.has_permission('voir_tous_magasins')
    or app.has_permission('gerer_achats')
    or app.has_permission('gerer_logistique')
    or app.has_permission('gerer_encaissements')
    or (p_store_id is not null and app.can_access_store(p_store_id))
$$;

-- Le rôle authenticated doit pouvoir résoudre les fonctions du schéma app
-- (les droits réels restent contrôlés fonction par fonction ci-dessous).
grant usage on schema app to authenticated;

revoke all on function
  app.current_profile_id(),
  app.current_org_id(),
  app.current_role_name(),
  app.role_permissions(text),
  app.has_permission(text),
  app.can_access_store(uuid),
  app.can_access_warehouse(uuid),
  app.can_read_order(uuid)
from public;

grant execute on function
  app.current_profile_id(),
  app.current_org_id(),
  app.current_role_name(),
  app.role_permissions(text),
  app.has_permission(text),
  app.can_access_store(uuid),
  app.can_access_warehouse(uuid),
  app.can_read_order(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Activation de la RLS sur toutes les tables métier
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.warehouses enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.user_store_access enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.suppliers enable row level security;
alter table public.product_suppliers enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.supplier_orders enable row level security;
alter table public.supplier_order_lines enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_legs enable row level security;
alter table public.payments enable row level security;
alter table public.acquisition_journeys enable row level security;
alter table public.approval_requests enable row level security;
alter table public.activity_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Policies de lecture
-- ---------------------------------------------------------------------------

create policy "org readable by active members"
  on public.organizations for select to authenticated
  using (id = app.current_org_id());

create policy "stores readable by active members"
  on public.stores for select to authenticated
  using (organization_id = app.current_org_id());

create policy "warehouses readable by active members"
  on public.warehouses for select to authenticated
  using (organization_id = app.current_org_id());

-- Profils : chacun lit son propre profil ; les membres actifs de
-- l'organisation lisent les profils (noms nécessaires aux historiques).
create policy "profiles readable by members"
  on public.profiles for select to authenticated
  using (id = auth.uid() or organization_id = app.current_org_id());

-- Un utilisateur ne modifie JAMAIS lui-même son rôle, son organisation ou
-- ses magasins : aucune policy insert/update/delete pour les non-admins.
-- (La gestion des utilisateurs se fera via le Dashboard/SQL admin, puis une
-- interface d'administration ultérieure.)

create policy "store access readable by owner or members"
  on public.user_store_access for select to authenticated
  using (profile_id = auth.uid() or exists (
    select 1 from public.profiles p
    where p.id = public.user_store_access.profile_id
      and p.organization_id = app.current_org_id()
  ));

create policy "customers readable by members"
  on public.customers for select to authenticated
  using (organization_id = app.current_org_id());

create policy "products readable by members"
  on public.products for select to authenticated
  using (organization_id = app.current_org_id());

create policy "variants readable by members"
  on public.product_variants for select to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.organization_id = app.current_org_id()
  ));

create policy "suppliers readable by members"
  on public.suppliers for select to authenticated
  using (organization_id = app.current_org_id());

create policy "product suppliers readable by members"
  on public.product_suppliers for select to authenticated
  using (organization_id = app.current_org_id());

create policy "orders readable by allowed roles"
  on public.orders for select to authenticated
  using (
    organization_id = app.current_org_id()
    and app.can_read_order(store_id)
  );

create policy "order lines readable via order"
  on public.order_lines for select to authenticated
  using (
    organization_id = app.current_org_id()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and app.can_read_order(o.store_id)
    )
  );

create policy "supplier orders readable by members"
  on public.supplier_orders for select to authenticated
  using (organization_id = app.current_org_id());

create policy "supplier order lines readable via parent"
  on public.supplier_order_lines for select to authenticated
  using (exists (
    select 1 from public.supplier_orders so
    where so.id = supplier_order_id
      and so.organization_id = app.current_org_id()
  ));

create policy "shipments readable by members"
  on public.shipments for select to authenticated
  using (organization_id = app.current_org_id());

create policy "shipment items readable via parent"
  on public.shipment_items for select to authenticated
  using (exists (
    select 1 from public.shipments s
    where s.id = shipment_id and s.organization_id = app.current_org_id()
  ));

create policy "shipment legs readable via parent"
  on public.shipment_legs for select to authenticated
  using (exists (
    select 1 from public.shipments s
    where s.id = shipment_id and s.organization_id = app.current_org_id()
  ));

-- Règlements : rôles finance/vente selon le magasin. La logistique n'a PAS
-- accès aux encaissements détaillés.
create policy "payments readable by allowed roles"
  on public.payments for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (
      app.has_permission('gerer_encaissements')
      or app.has_permission('voir_tous_magasins')
      or (
        app.has_permission('encaisser_reglement')
        and store_id is not null
        and app.can_access_store(store_id)
      )
    )
  );

create policy "acquisition readable by allowed roles"
  on public.acquisition_journeys for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (
      app.has_permission('voir_acquisition')
      or app.has_permission('voir_tous_magasins')
      or exists (
        select 1 from public.orders o
        where o.id = order_id and app.can_read_order(o.store_id)
      )
    )
  );

create policy "approvals readable by members"
  on public.approval_requests for select to authenticated
  using (organization_id = app.current_org_id());

create policy "activity readable by members"
  on public.activity_logs for select to authenticated
  using (organization_id = app.current_org_id());

-- ---------------------------------------------------------------------------
-- Policies d'écriture de référentiel (catalogue, fournisseurs).
-- Les écritures métier (commandes, règlements, validations, réceptions…)
-- ne passent QUE par les fonctions RPC de la migration 3.
-- ---------------------------------------------------------------------------

create policy "products managed by catalogue roles"
  on public.products for all to authenticated
  using (organization_id = app.current_org_id() and app.has_permission('gerer_catalogue'))
  with check (organization_id = app.current_org_id() and app.has_permission('gerer_catalogue'));

create policy "variants managed by catalogue roles"
  on public.product_variants for all to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_id
      and p.organization_id = app.current_org_id()
      and app.has_permission('gerer_catalogue')
  ))
  with check (exists (
    select 1 from public.products p
    where p.id = product_id
      and p.organization_id = app.current_org_id()
      and app.has_permission('gerer_catalogue')
  ));

create policy "suppliers managed by purchasing roles"
  on public.suppliers for all to authenticated
  using (organization_id = app.current_org_id() and app.has_permission('gerer_achats'))
  with check (organization_id = app.current_org_id() and app.has_permission('gerer_achats'));

create policy "product suppliers managed by purchasing roles"
  on public.product_suppliers for all to authenticated
  using (organization_id = app.current_org_id() and app.has_permission('gerer_achats'))
  with check (organization_id = app.current_org_id() and app.has_permission('gerer_achats'));

create policy "stores managed by admins"
  on public.stores for all to authenticated
  using (organization_id = app.current_org_id() and app.has_permission('administrer'))
  with check (organization_id = app.current_org_id() and app.has_permission('administrer'));

create policy "warehouses managed by admins"
  on public.warehouses for all to authenticated
  using (organization_id = app.current_org_id() and app.has_permission('administrer'))
  with check (organization_id = app.current_org_id() and app.has_permission('administrer'));
