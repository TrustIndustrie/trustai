-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 12 (affectation : contrôles manquants)
--
-- Prouve, sur une base réelle :
--   * une ligne pas encore arrivée n'est pas affectable ;
--   * une ligne en transfert non plus ;
--   * une ligne déjà sortie non plus ;
--   * une anomalie BLOQUANTE non résolue interdit l'affectation ;
--   * une ligne absente du récapitulatif non plus ;
--   * un dossier et une marchandise dans deux dépôts différents sont refusés ;
--   * une affectation légitime passe toujours ;
--   * la protection contre la suraffectation reste intacte.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('d1000000-0000-4000-d000-000000000001', 'resplog.d@test.local');

insert into public.profiles (id, organization_id, display_name, role)
values ('d1000000-0000-4000-d000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        'Resp. log. D', 'responsable_logistique');

-- ---------------------------------------------------------------------------
-- Jeu d'essai : une ligne par situation, deux dossiers (un par dépôt).
-- ---------------------------------------------------------------------------
create temporary table t as
select
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Aubagne' limit 1) as aubagne;

do $$
declare v record;
begin
  select * into v from t;

  insert into public.logistics_lines (
    id, organization_id, origin, origin_reason, designation, quantity,
    stage, current_warehouse_id)
  values
    ('d2000000-0000-4000-d000-00000000000a', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Disponible Argenteuil', 4, 'disponible', v.argenteuil),
    ('d2000000-0000-4000-d000-00000000000b', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Encore commandée', 2, 'commandee', null),
    ('d2000000-0000-4000-d000-00000000000c', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'En transfert', 2, 'en_transfert', v.argenteuil),
    ('d2000000-0000-4000-d000-00000000000d', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Reçue mais partielle', 4, 'recue_argenteuil', v.argenteuil),
    ('d2000000-0000-4000-d000-00000000000e', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Déjà sortie', 1, 'sortie', v.argenteuil),
    ('d2000000-0000-4000-d000-00000000000f', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Disponible mais annulée', 1, 'disponible', v.argenteuil),
    ('d2000000-0000-4000-d000-000000000010', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Disponible mais absente', 1, 'disponible', v.argenteuil),
    ('d2000000-0000-4000-d000-000000000011', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Disponible Aubagne', 2, 'disponible', v.aubagne);

  -- Anomalie bloquante sur la ligne « f ».
  insert into public.logistics_anomalies (
    organization_id, logistics_line_id, type, severity, message)
  values ('00000000-0000-4000-a000-000000000001',
          'd2000000-0000-4000-d000-00000000000f',
          'annulation_signalee', 'bloquant', 'Commande annulée, marchandise reçue.');

  -- Ligne « 10 » disparue du récapitulatif.
  update public.logistics_lines set missing_since = now()
  where id = 'd2000000-0000-4000-d000-000000000010';

  insert into public.delivery_jobs (
    id, organization_id, reference, customer_name, origin_warehouse_id)
  values
    ('d3000000-0000-4000-d000-000000000001', '00000000-0000-4000-a000-000000000001',
     'LIV-ARG-1', 'Client Argenteuil', v.argenteuil),
    ('d3000000-0000-4000-d000-000000000002', '00000000-0000-4000-a000-000000000001',
     'LIV-AUB-1', 'Client Aubagne', v.aubagne),
    ('d3000000-0000-4000-d000-000000000003', '00000000-0000-4000-a000-000000000001',
     'LIV-SANS-DEPOT', 'Client sans dépôt imposé', null);
end $$;

-- ===========================================================================
-- Les refus attendus
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d000-000000000001';

do $$
declare
  v_cas record;
  v_refuse boolean;
  v_echecs text := '';
  v_msg text;
begin
  for v_cas in
    select * from (values
      ('d2000000-0000-4000-d000-00000000000b', 'ligne encore commandée'),
      ('d2000000-0000-4000-d000-00000000000c', 'ligne en transfert'),
      ('d2000000-0000-4000-d000-00000000000d', 'ligne reçue mais partielle'),
      ('d2000000-0000-4000-d000-00000000000e', 'ligne déjà sortie'),
      ('d2000000-0000-4000-d000-00000000000f', 'anomalie bloquante ouverte'),
      ('d2000000-0000-4000-d000-000000000010', 'ligne absente du récapitulatif')
    ) as c(ligne, libelle)
  loop
    v_refuse := false;
    begin
      perform public.allocate_to_delivery_job(
        v_cas.ligne::uuid, 'd3000000-0000-4000-d000-000000000003', 1);
    exception when others then
      v_refuse := true;
      v_msg := sqlerrm;
    end;
    if not v_refuse then
      v_echecs := v_echecs || v_cas.libelle || ' ; ';
    end if;
  end loop;

  if v_echecs <> '' then
    raise exception 'ECHEC : affectation acceptée à tort pour : %', v_echecs;
  end if;
  raise notice 'TEST 1 OK — six situations refusées : pas encore arrivée, en transfert, partielle, sortie, bloquante, absente';
end $$;

-- ===========================================================================
-- Cohérence de dépôt
-- ===========================================================================
do $$
declare v_refuse boolean := false;
begin
  -- Marchandise à Argenteuil, dossier qui part d'Aubagne.
  begin
    perform public.allocate_to_delivery_job(
      'd2000000-0000-4000-d000-00000000000a',
      'd3000000-0000-4000-d000-000000000002', 1);
  exception when others then v_refuse := true;
  end;
  if not v_refuse then
    raise exception 'ECHEC : un dossier Aubagne a été servi depuis Argenteuil';
  end if;
  raise notice 'TEST 2 OK — dépôts incohérents refusés';
end $$;

-- ===========================================================================
-- Les affectations légitimes passent toujours
-- ===========================================================================
do $$
declare v_id uuid;
begin
  -- Même dépôt.
  v_id := public.allocate_to_delivery_job(
    'd2000000-0000-4000-d000-00000000000a',
    'd3000000-0000-4000-d000-000000000001', 2);
  if v_id is null then raise exception 'ECHEC : affectation légitime refusée'; end if;

  -- Dossier sans dépôt imposé : aucune contrainte de lieu.
  v_id := public.allocate_to_delivery_job(
    'd2000000-0000-4000-d000-000000000011',
    'd3000000-0000-4000-d000-000000000003', 1);
  if v_id is null then
    raise exception 'ECHEC : dossier sans dépôt imposé refusé à tort';
  end if;
  raise notice 'TEST 3 OK — les affectations légitimes passent';
end $$;

-- ===========================================================================
-- La protection contre la suraffectation tient toujours
-- ===========================================================================
do $$
declare v_refuse boolean := false;
begin
  -- 2 déjà affectés sur 4 : en demander 3 de plus doit échouer.
  begin
    perform public.allocate_to_delivery_job(
      'd2000000-0000-4000-d000-00000000000a',
      'd3000000-0000-4000-d000-000000000001', 3);
  exception when others then v_refuse := true;
  end;
  if not v_refuse then
    raise exception 'ECHEC : suraffectation acceptée';
  end if;
  raise notice 'TEST 4 OK — suraffectation toujours impossible';
end $$;
reset role;

do $$
declare v_sum integer; v_qty integer;
begin
  select coalesce(sum(quantity_allocated), 0) into v_sum
  from public.delivery_allocations
  where logistics_line_id = 'd2000000-0000-4000-d000-00000000000a'
    and status <> 'annulee';
  select quantity into v_qty from public.logistics_lines
  where id = 'd2000000-0000-4000-d000-00000000000a';
  if v_sum > v_qty then
    raise exception 'ECHEC : % affectés pour une quantité de %', v_sum, v_qty;
  end if;
  raise notice 'TEST 4b OK — invariant respecté : % sur %', v_sum, v_qty;
end $$;

rollback;

\echo 'TOUS LES TESTS PHASE 4 SONT PASSES (transaction annulée, base intacte).'
