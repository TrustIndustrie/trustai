-- ===========================================================================
-- TRUST AI — tests des policies RLS et des fonctions métier
--
-- Exécution locale (voir docs/SUPABASE_SETUP.md, section Tests) :
-- ce script suppose les migrations + seed appliqués et un schéma auth
-- présent (réel sur Supabase, stub en local). Chaque assertion lève une
-- exception si elle échoue ; le script se termine par un ROLLBACK : il ne
-- laisse AUCUNE donnée derrière lui.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Jeu d'essai : 6 employés fictifs (aucun mot de passe : lignes auth.users
-- de test uniquement, jamais utilisées en production)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('10000000-0000-4000-a000-000000000001', 'vendeuse.herblay@test.local'),
  ('10000000-0000-4000-a000-000000000002', 'responsable.herblay@test.local'),
  ('10000000-0000-4000-a000-000000000003', 'achats@test.local'),
  ('10000000-0000-4000-a000-000000000004', 'logistique@test.local'),
  ('10000000-0000-4000-a000-000000000005', 'comptabilite@test.local'),
  ('10000000-0000-4000-a000-000000000006', 'direction@test.local');

insert into public.profiles (id, organization_id, display_name, role, primary_store_id) values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Vendeuse Herblay', 'vendeur', '00000000-0000-4000-a000-000000000202'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Responsable Herblay', 'responsable_magasin', '00000000-0000-4000-a000-000000000202'),
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'Acheteuse', 'achats', null),
  ('10000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', 'Logisticien', 'logistique', null),
  ('10000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001', 'Comptable', 'comptabilite', null),
  ('10000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001', 'Directrice', 'direction', null);

insert into public.user_store_access (profile_id, store_id) values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000202'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000202');

-- Une commande existante sur LISSES (magasin NON autorisé pour la vendeuse
-- d'Herblay), créée par le superuser pour le test.
insert into public.customers (id, organization_id, name, phone)
values ('20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Client Test Lisses', '06 00 00 00 90');
insert into public.orders (id, organization_id, reference, origin, store_id, customer_id, ordered_at, fulfillment_mode)
values ('20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'MAG-LIS-2026-0001', 'MAGASIN',
        '00000000-0000-4000-a000-000000000201', '20000000-0000-4000-a000-000000000001', now(), 'retrait_magasin');
insert into public.order_lines (id, organization_id, order_id, product_name, quantity, unit_price_cents)
values ('20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000002', 'Produit Lisses', 1, 10000);
insert into public.payments (organization_id, order_id, amount_cents, method, store_id)
values ('00000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002', 4000, 'especes',
        '00000000-0000-4000-a000-000000000201');

-- ---------------------------------------------------------------------------
-- 0. RLS activée sur toutes les tables métier du schéma public
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(tablename, ', ') into v_missing
  from pg_tables t
  where schemaname = 'public'
    and not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
    );
  if v_missing is not null then
    raise exception 'RLS manquante sur : %', v_missing;
  end if;
  raise notice 'TEST 0 OK — RLS activée sur toutes les tables publiques';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Non authentifié : aucune donnée métier lisible
-- ---------------------------------------------------------------------------
set role anon;
do $$
begin
  if (select count(*) from public.orders) <> 0 then
    raise exception 'anon ne doit lire aucune commande';
  end if;
  if (select count(*) from public.customers) <> 0 then
    raise exception 'anon ne doit lire aucun client';
  end if;
  if (select count(*) from public.suppliers) <> 0 then
    raise exception 'anon ne doit lire aucun fournisseur';
  end if;
  raise notice 'TEST 1 OK — anon : aucune lecture';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 2. Vendeuse Herblay : limitée à son magasin, règles financières V1.2
-- ---------------------------------------------------------------------------
-- NOTE (phase 1) : depuis le recentrage logistique, Skara est la SOURCE DE
-- CRÉATION des commandes et `create_store_order` n'est plus exécutable
-- depuis l'application. Les assertions qui portaient sur le comportement de
-- cette fonction (magasin non autorisé refusé, identité prise dans la
-- session, hors catalogue réservé) ne sont donc plus vérifiables ici : elles
-- sont remplacées par la vérification que la fonction est bien refusée.
-- Les règles encore en vigueur (visibilité par magasin, règlements, rôle non
-- modifiable, validation interdite) restent testées ci-dessous, sur une
-- commande insérée hors session.
insert into public.customers (id, organization_id, name, phone)
values ('20000000-0000-4000-a000-000000000010',
        '00000000-0000-4000-a000-000000000001', 'Client Herblay Test', '06 00 00 00 91');
insert into public.orders (
  id, organization_id, reference, origin, store_id, salesperson_profile_id,
  customer_id, ordered_at, fulfillment_mode)
values ('20000000-0000-4000-a000-000000000011',
        '00000000-0000-4000-a000-000000000001', 'MAG-HER-2026-0001', 'MAGASIN',
        '00000000-0000-4000-a000-000000000202',
        '10000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000010', now(), 'retrait_magasin');
insert into public.order_lines (
  organization_id, order_id, product_name, quantity, unit_price_cents)
values ('00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000011', 'Chaise Vera', 2, 12900);
insert into public.payments (
  organization_id, order_id, amount_cents, method, store_id)
values ('00000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000011', 5000, 'especes',
        '00000000-0000-4000-a000-000000000202');

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_order uuid := '20000000-0000-4000-a000-000000000011';
begin
  -- Ne voit PAS la commande de Lisses (magasin non autorisé).
  if (select count(*) from public.orders where reference = 'MAG-LIS-2026-0001') <> 0 then
    raise exception 'La vendeuse d''Herblay ne doit pas voir les commandes de Lisses';
  end if;

  -- Voit BIEN la commande de son propre magasin.
  if (select count(*) from public.orders where id = v_order) <> 1 then
    raise exception 'La vendeuse doit voir les commandes de son magasin';
  end if;

  -- La création de commande magasin n'est plus exécutable (Skara fait foi).
  begin
    perform public.create_store_order('{}'::jsonb);
    raise exception 'create_store_order devrait être révoquée depuis la phase 1';
  exception when insufficient_privilege then null;
  end;

  -- Règles V1.2 : règlement > RAP refusé, puis RAP nul refusé.
  begin
    perform public.add_payment(v_order, 999999, now(), 'carte_bancaire');
    raise exception 'Règlement supérieur au RAP accepté à tort';
  exception when raise_exception then null;
  end;
  perform public.add_payment(v_order, 20800, now(), 'carte_bancaire'); -- solde exact
  begin
    perform public.add_payment(v_order, 100, now(), 'especes');
    raise exception 'Règlement sur commande soldée accepté à tort';
  exception when raise_exception then null;
  end;

  -- Ne peut pas s''attribuer un autre rôle (0 ligne modifiée par RLS).
  update public.profiles set role = 'administrateur'
  where id = '10000000-0000-4000-a000-000000000001';
  if exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-a000-000000000001' and role = 'administrateur'
  ) then
    raise exception 'Un vendeur a pu changer son propre rôle';
  end if;

  -- Ne peut pas valider une décision.
  begin
    perform public.decide_approval('20000000-0000-4000-a000-00000000000f', true, 'x', null);
    raise exception 'decide_approval accessible à tort à un vendeur';
  exception when insufficient_privilege then null;
  end;

  raise notice 'TEST 2 OK — vendeur limité à son magasin, création révoquée, règles V1.2';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Annulation : responsable ne valide pas sa propre demande ; motif requis
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_order uuid;
  v_req uuid;
  v_total_before integer;
begin
  select id into v_order from public.orders where reference like 'MAG-HER-%' limit 1;
  v_total_before := app.order_total_cents(v_order);
  v_req := public.request_order_cancellation(v_order);

  -- Motif obligatoire.
  begin
    perform public.decide_approval(v_req, true, null, null);
    raise exception 'Annulation validée sans motif';
  exception when raise_exception then null;
  end;

  -- Le demandeur ne peut pas valider sa propre demande.
  begin
    perform public.decide_approval(v_req, true, 'Motif test', null);
    raise exception 'Le demandeur a validé sa propre annulation';
  exception when insufficient_privilege then null;
  end;

  -- La direction valide (avec motif) : commande annulée, historique conservé.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000006', false);
  perform public.decide_approval(v_req, true, 'Motif de test direction', null);
  if (select status from public.orders where id = v_order) <> 'annulee' then
    raise exception 'Commande non annulée après validation';
  end if;
  if app.order_total_cents(v_order) <> v_total_before then
    raise exception 'Le total historique a changé après annulation';
  end if;
  if app.order_rap_cents(v_order) <> 0 then
    raise exception 'Le RAP d''une commande annulée doit être 0';
  end if;
  if (select count(*) from public.payments where order_id = v_order) < 2 then
    raise exception 'Les règlements doivent être conservés après annulation';
  end if;
  raise notice 'TEST 3 OK — annulation : motif requis, auto-validation bloquée, historique conservé';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Achats : proposition + validation fournisseur ; logistique : réception
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000003', false);
do $$
declare
  v_line uuid;
  v_supplier uuid;
  v_so uuid;
  v_req uuid;
begin
  select id into v_supplier from public.suppliers where name = 'Eleonora';
  select id into v_line from public.order_lines where product_name = 'Produit Lisses' limit 1;
  v_so := public.prepare_supplier_order(v_supplier, array[v_line]);
  select id into v_req from public.approval_requests
  where related_supplier_order_id = v_so and status = 'en_attente';
  perform public.decide_approval(v_req, true, null, null);
  if (select status from public.supplier_orders where id = v_so) <> 'validee' then
    raise exception 'Commande fournisseur non validée';
  end if;
  raise notice 'TEST 4 OK — achats : proposition et validation fournisseur';
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000004', false);
do $$
declare
  v_ship uuid;
  v_item uuid;
begin
  -- La logistique ne voit PAS les règlements détaillés.
  if (select count(*) from public.payments) <> 0 then
    raise exception 'La logistique ne doit pas lire les règlements';
  end if;

  -- Mais elle réceptionne un arrivage (créé par un rôle autorisé : ici seed superuser absent, on passe par la direction).
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000006', false);
  insert into public.shipments (id, organization_id, reference, origin_label, destination_label, mode, status, warehouse_id)
  values ('30000000-0000-4000-a000-000000000001', app.current_org_id(), 'TRA-2026-0001',
          'Fournisseur Test', 'Dépôt d''Argenteuil', 'retrait_trust', 'en_transit',
          '00000000-0000-4000-a000-000000000101');
  raise exception 'insert direct shipments aurait dû être bloqué par RLS';
exception when insufficient_privilege then
  raise notice 'TEST 5a OK — insertion directe d''arrivage bloquée par RLS (écritures via RPC uniquement)';
end $$;

-- Réception via superuser-préparé (le flux de création d'arrivage par
-- l'interface arrivera avec les écrans logistique dédiés).
reset role;
insert into public.shipments (id, organization_id, reference, origin_label, destination_label, mode, status, warehouse_id)
values ('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'TRA-2026-0001',
        'Fournisseur Test', 'Dépôt d''Argenteuil', 'retrait_trust', 'en_transit',
        '00000000-0000-4000-a000-000000000101');
insert into public.shipment_items (id, shipment_id, product_name, quantity)
values ('30000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000001', 'Miroir Wave', 4);
insert into public.shipment_legs (shipment_id, sequence, origin_type, origin_label, destination_type, destination_label, mode, status)
values ('30000000-0000-4000-a000-000000000001', 1, 'fournisseur', 'Fournisseur Test', 'depot', 'Dépôt d''Argenteuil', 'retrait_trust', 'en_transit');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000004', false);
do $$
begin
  -- Réception partielle
  perform public.receive_shipment('30000000-0000-4000-a000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'item_id', '30000000-0000-4000-a000-000000000002', 'quantity_received', 2)));
  if (select status from public.shipments where id = '30000000-0000-4000-a000-000000000001') <> 'recu_partiellement' then
    raise exception 'Statut « reçu partiellement » attendu';
  end if;
  -- Réception complète
  perform public.receive_shipment('30000000-0000-4000-a000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'item_id', '30000000-0000-4000-a000-000000000002', 'quantity_received', 4)));
  if (select status from public.shipments where id = '30000000-0000-4000-a000-000000000001') <> 'recu' then
    raise exception 'Statut « reçu » attendu';
  end if;
  if (select status from public.shipment_legs where shipment_id = '30000000-0000-4000-a000-000000000001' and sequence = 1) <> 'recu' then
    raise exception 'Étape logistique non mise à jour';
  end if;
  raise notice 'TEST 5b OK — logistique : réception partielle puis complète';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Comptabilité : lit les règlements, ne crée pas de commande
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000005', false);
do $$
begin
  if (select count(*) from public.payments) = 0 then
    raise exception 'La comptabilité doit lire les règlements';
  end if;
  begin
    perform public.create_store_order(jsonb_build_object(
      'store_id', '00000000-0000-4000-a000-000000000202',
      'fulfillment_mode', 'retrait_magasin',
      'customer', jsonb_build_object('name', 'Z', 'phone', '06'),
      'lines', jsonb_build_array(jsonb_build_object(
        'product_name', 'Test', 'quantity', 1, 'unit_price_cents', 1000)),
      'payments', '[]'::jsonb
    ));
    raise exception 'La comptabilité a créé une commande à tort';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TEST 6 OK — comptabilité : règlements lisibles, création de commande refusée';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Profil désactivé : plus aucun accès
-- ---------------------------------------------------------------------------
reset role;
update public.profiles set active = false
where id = '10000000-0000-4000-a000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000001', false);
do $$
begin
  if (select count(*) from public.orders) <> 0 then
    raise exception 'Un profil désactivé ne doit plus lire les commandes';
  end if;
  begin
    perform public.add_payment('20000000-0000-4000-a000-000000000002', 100, now(), 'especes');
    raise exception 'Un profil désactivé a pu écrire';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TEST 7 OK — profil désactivé : accès coupé';
end $$;

reset role;
rollback;
\echo 'TOUS LES TESTS RLS/METIER SONT PASSES (transaction annulée, base intacte).'
