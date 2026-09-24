-- ============================================================================
-- RETOUR ARRIÈRE — Migration 14 : PANIERS ABANDONNÉS
-- ----------------------------------------------------------------------------
-- À exécuter AVANT les retours arrière des migrations 13 et antérieures :
-- les retours arrière se déroulent dans l'ordre inverse des migrations.
--
-- Ce script supprime les quatre tables de la migration 14, ses fonctions, le
-- déclencheur d'attribution posé sur `orders`, la colonne
-- `orders.shopify_checkout_token`, et REMET `app.org_of` dans sa version de
-- la migration 9 (sans les types « order » et « abandoned_checkout »).
--
-- AVERTISSEMENT : les paniers abandonnés collectés, leur historique, la file
-- d'envoi et les désinscriptions sont PERDUS. Les désinscriptions en
-- particulier ne sont pas reconstituables depuis Shopify : exporter
-- `message_suppressions` avant d'exécuter ce script.
-- ============================================================================

begin;

-- 1. Attribution : déclencheur puis fonction.
drop trigger if exists attach_abandoned_checkout on public.orders;
drop function if exists app.attach_order_to_abandoned_checkout();

-- 2. RPC de la migration 14.
drop function if exists public.set_abandoned_checkout_exclusion(uuid, boolean, text);
drop function if exists public.upsert_abandoned_checkouts(jsonb, uuid);
drop function if exists public.get_abandoned_checkout(uuid);
drop function if exists public.list_abandoned_checkouts(text, integer);

-- 3. Fonctions internes de la migration 14.
drop function if exists app.abandoned_checkout_status(uuid, text, boolean);
drop function if exists app.normalize_contact(text);

-- 4. Tables (l'ordre suit les dépendances : l'historique référence les paniers).
drop trigger if exists same_org_guard on public.abandoned_checkout_events;
drop trigger if exists append_only_guard on public.abandoned_checkout_events;
drop trigger if exists same_org_guard on public.shopify_abandoned_checkouts;
drop table if exists public.abandoned_checkout_events;
drop table if exists public.customer_messages;
drop table if exists public.message_suppressions;
drop table if exists public.shopify_abandoned_checkouts;

-- 5. Colonne d'attribution sur les commandes.
drop index if exists public.orders_shopify_checkout_token_idx;
alter table public.orders drop column if exists shopify_checkout_token;

-- 6. `app.org_of` remise dans sa version de la migration 9.
create or replace function app.org_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_id is null then return null; end if;
  case p_kind
    when 'profile' then
      select organization_id into v_org from public.profiles where id = p_id;
    when 'store' then
      select organization_id into v_org from public.stores where id = p_id;
    when 'warehouse' then
      select organization_id into v_org from public.warehouses where id = p_id;
    when 'supplier' then
      select organization_id into v_org from public.suppliers where id = p_id;
    when 'customer' then
      select organization_id into v_org from public.customers where id = p_id;
    when 'variant' then
      select p.organization_id into v_org
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.id = p_id;
    when 'recap_source' then
      select organization_id into v_org from public.recap_sources where id = p_id;
    when 'recap_read' then
      select organization_id into v_org from public.recap_reads where id = p_id;
    when 'logistics_line' then
      select organization_id into v_org from public.logistics_lines where id = p_id;
    when 'delivery_job' then
      select organization_id into v_org from public.delivery_jobs where id = p_id;
    when 'document' then
      select organization_id into v_org from public.skara_documents where id = p_id;
    when 'extraction' then
      select organization_id into v_org from public.skara_document_extractions where id = p_id;
    else
      raise exception 'Type d''objet inconnu pour le contrôle d''organisation : %', p_kind;
  end case;
  return v_org;
end;
$$;
revoke all on function app.org_of(text, uuid) from public, anon, authenticated;

commit;
