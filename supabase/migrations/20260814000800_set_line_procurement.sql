-- ============================================================================
-- TRUST AI — Migration 8 : qualifier une ligne de commande (mode connecté)
-- ----------------------------------------------------------------------------
-- Chaînon manquant du parcours : une commande (Shopify ou magasin) arrive
-- avec ses lignes « à vérifier ». Tant que l'équipe ne les qualifie pas
-- (stock local / à commander / indisponible), rien n'entre dans les achats
-- fournisseurs, donc ni validation, ni relance, ni arrivage.
--
-- En mode démonstration cette action existait déjà côté navigateur ; en mode
-- connecté elle doit passer par le serveur pour rejouer les mêmes règles avec
-- l'identité réelle (auth.uid()) :
--   * permission « gerer_achats » exigée ;
--   * ligne de l'organisation de l'utilisateur uniquement ;
--   * jamais sur une commande annulée, ni sur une ligne annulée ;
--   * statuts « pilotés par le système » (en_attente_validation, commande,
--     pret_fournisseur, en_transport, recu_depot, relance_due) refusés : ils
--     appartiennent aux RPC dédiées (proposition, validation, réception) ;
--   * fournisseurs et dépôt vérifiés (même organisation) ;
--   * « à commander » exige un fournisseur principal — sans quoi la ligne ne
--     pourrait jamais être regroupée dans une commande fournisseur ;
--   * toute qualification est journalisée.
-- ============================================================================

create or replace function public.set_line_procurement(
  p_line_id uuid,
  p_status text,
  p_supplier_id uuid default null,
  p_alt_supplier_id uuid default null,
  p_destination_warehouse_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_line public.order_lines%rowtype;
  v_order public.orders%rowtype;
begin
  perform app.require_permission('gerer_achats');
  v_org := app.current_org_id();

  -- Seuls les statuts décidés par un humain sont acceptés ici.
  if p_status not in ('a_verifier', 'stock_local', 'a_commander', 'indisponible') then
    raise exception 'Statut « % » non modifiable manuellement : il est piloté par le suivi (proposition, validation, réception).', p_status;
  end if;

  select * into v_line from public.order_lines
  where id = p_line_id and organization_id = v_org;
  if not found then
    raise exception 'Article introuvable.';
  end if;

  select * into v_order from public.orders where id = v_line.order_id;
  if v_order.status = 'annulee' then
    raise exception 'Commande annulée : son suivi ne peut plus être modifié.';
  end if;
  if v_line.procurement_status = 'annule' then
    raise exception 'Article annulé : son suivi ne peut plus être modifié.';
  end if;
  if v_line.procurement_status not in ('a_verifier', 'stock_local', 'a_commander', 'indisponible') then
    raise exception 'Article déjà engagé dans le suivi fournisseur : utilisez les pages Achats, Relances ou Arrivages.';
  end if;

  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers
                     where id = p_supplier_id and organization_id = v_org) then
    raise exception 'Fournisseur introuvable.';
  end if;
  if p_alt_supplier_id is not null
     and not exists (select 1 from public.suppliers
                     where id = p_alt_supplier_id and organization_id = v_org) then
    raise exception 'Fournisseur alternatif introuvable.';
  end if;
  if p_destination_warehouse_id is not null
     and not exists (select 1 from public.warehouses
                     where id = p_destination_warehouse_id and organization_id = v_org) then
    raise exception 'Dépôt introuvable.';
  end if;
  if p_status = 'a_commander' and p_supplier_id is null then
    raise exception 'Un article à commander doit indiquer son fournisseur principal.';
  end if;

  update public.order_lines
  set procurement_status = p_status,
      supplier_id = coalesce(p_supplier_id, supplier_id),
      alt_supplier_id = coalesce(p_alt_supplier_id, alt_supplier_id),
      destination_warehouse_id = coalesce(p_destination_warehouse_id, destination_warehouse_id)
  where id = p_line_id;

  perform app.log_activity(
    v_org,
    'Suivi d''article mis à jour',
    v_order.reference || ' — « ' || v_line.product_name || ' » : ' ||
    case p_status
      when 'stock_local' then 'disponible en stock local'
      when 'a_commander' then 'à commander chez le fournisseur'
      when 'indisponible' then 'indisponible'
      else 'à vérifier'
    end || '.',
    v_line.order_id
  );
end;
$$;

revoke all on function public.set_line_procurement(uuid, text, uuid, uuid, uuid) from public;
grant execute on function public.set_line_procurement(uuid, text, uuid, uuid, uuid) to authenticated;
