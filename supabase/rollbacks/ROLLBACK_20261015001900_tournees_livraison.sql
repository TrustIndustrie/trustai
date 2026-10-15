-- ============================================================================
-- RETOUR ARRIÈRE — Migration 19 : TOURNÉES DE LIVRAISON
-- ----------------------------------------------------------------------------
-- À exécuter AVANT le retour arrière de la migration 18, donc en premier :
-- les retours arrière se déroulent dans l'ordre inverse des migrations.
--
-- CE SCRIPT PERD DES DONNÉES : les tournées et leurs passages disparaissent,
-- donc l'ordre de route et les résultats de livraison saisis avec eux.
--
-- CE QU'IL NE DÉFAIT PAS, VOLONTAIREMENT : les conséquences des livraisons
-- déjà enregistrées. Une marchandise sortie du stock est sortie, une
-- affectation livrée reste livrée, un dossier terminé reste terminé. Ce sont
-- des faits, pas des états techniques : les réécrire serait un mensonge.
--
-- `app.org_of` est rétablie dans sa forme antérieure, sans les deux cas
-- ajoutés par la migration 19.
-- ============================================================================

begin;

drop function if exists public.list_round_candidates(date, uuid);
drop function if exists public.get_delivery_round(uuid);
drop function if exists public.list_delivery_rounds(jsonb);
drop function if exists public.record_round_stop_outcome(uuid, text, text);
drop function if exists public.start_delivery_round(uuid);
drop function if exists public.plan_delivery_round(uuid);
drop function if exists public.reorder_round_stops(uuid, uuid[]);
drop function if exists public.remove_round_stop(uuid);
drop function if exists public.add_round_stop(uuid, uuid);
drop function if exists public.create_delivery_round(jsonb);

drop table if exists public.delivery_round_stops;
drop table if exists public.delivery_rounds;

-- Rétablissement de la forme antérieure, sans « delivery_slot » ni
-- « delivery_round ».
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
      -- L'organisation d'une variante est portée par son produit.
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

commit;
