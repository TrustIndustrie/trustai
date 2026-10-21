-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 20 (droits du livreur, lot 2C)
--
-- Prouve, sur une base réelle :
--   1. le livreur reçoit exactement deux permissions, et pas une de plus ;
--   2. il ne voit QUE ses propres tournées — celle d'un collègue lui est
--      refusée avec le même message qu'une autre organisation, pour qu'il
--      n'apprenne rien de son existence ;
--   3. il obtient l'adresse et le téléphone, sans quoi il ne peut pas livrer ;
--   4. il n'obtient PAS les montants à encaisser, et le responsable si ;
--   5. il ne solde que les passages de sa tournée ;
--   6. il ne démarre que sa tournée ;
--   7. il ne compose rien : ni création, ni ajout, ni ordre, ni planification ;
--   8. la consultation des coordonnées est journalisée ;
--   9. le responsable logistique garde sa vision globale.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('a2000000-0000-4000-a200-000000000001', 'resplog.livreur@test.local'),
  ('a2000000-0000-4000-a200-000000000002', 'karim.livreur@test.local'),
  ('a2000000-0000-4000-a200-000000000003', 'sonia.livreur@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('a2000000-0000-4000-a200-000000000001', '00000000-0000-4000-a000-000000000001',
   'Resp. logistique', 'responsable_logistique'),
  ('a2000000-0000-4000-a200-000000000002', '00000000-0000-4000-a000-000000000001',
   'Karim', 'livreur'),
  ('a2000000-0000-4000-a200-000000000003', '00000000-0000-4000-a000-000000000001',
   'Sonia', 'livreur');

-- ---------------------------------------------------------------------------
-- 1. La matrice, telle qu'elle est écrite
-- ---------------------------------------------------------------------------
do $$
declare v_perms text[];
begin
  v_perms := app.role_permissions('livreur');
  if not ('voir_coordonnees_client' = any (v_perms))
     or not ('executer_livraison' = any (v_perms)) then
    raise exception 'ÉCHEC 1 : le livreur n''a pas ses deux permissions : %', v_perms;
  end if;
  -- Ce qu'il ne doit PAS avoir, nommément.
  if 'voir_montants_livraison' = any (v_perms) then
    raise exception 'ÉCHEC 1 : le livreur voit les montants à encaisser';
  end if;
  if 'gerer_livraisons' = any (v_perms) or 'gerer_logistique' = any (v_perms) then
    raise exception 'ÉCHEC 1 : le livreur peut composer des tournées';
  end if;
  if array_length(v_perms, 1) <> 2 then
    raise exception 'ÉCHEC 1 : % permission(s) au lieu de 2 : %',
      array_length(v_perms, 1), v_perms;
  end if;
  raise notice 'OK 1 : le livreur a strictement ce qu''il faut pour livrer.';
end $$;

-- ---------------------------------------------------------------------------
-- Jeu d'essai : deux tournées du même jour, une par livreur.
-- ---------------------------------------------------------------------------
create temporary table t as
select
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  (current_date + 3)::date as jour;
grant all on t to authenticated;

create temporary table ids (karim uuid, sonia uuid, stop_karim uuid, stop_sonia uuid);
insert into ids values (null, null, null, null);
grant all on ids to authenticated;

do $$
declare v record; v_karim uuid; v_sonia uuid;
begin
  select * into v from t;

  insert into public.logistics_lines (
    id, organization_id, origin, origin_reason, designation, quantity,
    stage, current_warehouse_id)
  values
    ('a3000000-0000-4000-a300-000000000001', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Canapé Karim', 1, 'disponible', v.argenteuil),
    ('a3000000-0000-4000-a300-000000000002', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Table Sonia', 1, 'disponible', v.argenteuil);

  insert into public.delivery_jobs (
    id, organization_id, reference, customer_name, customer_phone,
    address_line, city, postal_code, access_notes,
    origin_warehouse_id, remise_type, stage,
    contact_authorized_at, contact_authorized_by)
  values
    ('a4000000-0000-4000-a400-000000000001', '00000000-0000-4000-a000-000000000001',
     'LIV-KARIM', 'Client de Karim', '+33600000021',
     '10 rue des Tests', 'Argenteuil', '95100', 'Code 1234, 3e étage',
     v.argenteuil, 'livraison_piece', 'creneau_confirme', now(),
     'a2000000-0000-4000-a200-000000000001'),
    ('a4000000-0000-4000-a400-000000000002', '00000000-0000-4000-a000-000000000001',
     'LIV-SONIA', 'Client de Sonia', '+33600000022',
     '20 rue des Tests', 'Argenteuil', '95100', 'Portail bleu',
     v.argenteuil, 'livraison_piece', 'creneau_confirme', now(),
     'a2000000-0000-4000-a200-000000000001');

  insert into public.delivery_allocations (
    organization_id, logistics_line_id, delivery_job_id, quantity_allocated)
  values
    ('00000000-0000-4000-a000-000000000001', 'a3000000-0000-4000-a300-000000000001',
     'a4000000-0000-4000-a400-000000000001', 1),
    ('00000000-0000-4000-a000-000000000001', 'a3000000-0000-4000-a300-000000000002',
     'a4000000-0000-4000-a400-000000000002', 1);

  insert into public.delivery_slots (
    organization_id, delivery_job_id, slot_date, slot_window, status,
    proposed_by, answered_by, answered_at)
  values
    ('00000000-0000-4000-a000-000000000001', 'a4000000-0000-4000-a400-000000000001',
     v.jour, 'matin', 'retenue', 'a2000000-0000-4000-a200-000000000001',
     'a2000000-0000-4000-a200-000000000001', now()),
    ('00000000-0000-4000-a000-000000000001', 'a4000000-0000-4000-a400-000000000002',
     v.jour, 'apres_midi', 'retenue', 'a2000000-0000-4000-a200-000000000001',
     'a2000000-0000-4000-a200-000000000001', now());

  insert into public.delivery_rounds (
    organization_id, round_date, warehouse_id, label, driver_profile_id, stage)
  values
    ('00000000-0000-4000-a000-000000000001', v.jour, v.argenteuil,
     'Tournée de Karim', 'a2000000-0000-4000-a200-000000000002', 'planifiee')
  returning id into v_karim;
  insert into public.delivery_rounds (
    organization_id, round_date, warehouse_id, label, driver_profile_id, stage)
  values
    ('00000000-0000-4000-a000-000000000001', v.jour, v.argenteuil,
     'Tournée de Sonia', 'a2000000-0000-4000-a200-000000000003', 'planifiee')
  returning id into v_sonia;

  insert into public.delivery_round_stops (
    organization_id, round_id, delivery_job_id, slot_id, position)
  select '00000000-0000-4000-a000-000000000001', v_karim,
         'a4000000-0000-4000-a400-000000000001',
         (select id from public.delivery_slots
           where delivery_job_id = 'a4000000-0000-4000-a400-000000000001'), 1;
  insert into public.delivery_round_stops (
    organization_id, round_id, delivery_job_id, slot_id, position)
  select '00000000-0000-4000-a000-000000000001', v_sonia,
         'a4000000-0000-4000-a400-000000000002',
         (select id from public.delivery_slots
           where delivery_job_id = 'a4000000-0000-4000-a400-000000000002'), 1;

  update ids set
    karim = v_karim,
    sonia = v_sonia,
    stop_karim = (select id from public.delivery_round_stops where round_id = v_karim),
    stop_sonia = (select id from public.delivery_round_stops where round_id = v_sonia);
end $$;

-- ===========================================================================
-- 2, 3, 4. Ce que Karim voit, et ce qu'il ne voit pas
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a2000000-0000-4000-a200-000000000002';

do $$
declare v_i record; v_list jsonb; v_plan jsonb; v_passage jsonb;
begin
  select * into v_i from ids;

  -- 2. Une seule tournée : la sienne.
  v_list := public.list_delivery_rounds('{}'::jsonb);
  if v_list->>'scope' <> 'propre' then
    raise exception 'ÉCHEC 2 : portée « % » pour un livreur', v_list->>'scope';
  end if;
  if (v_list->'totals'->>'tournees')::int <> 1 then
    raise exception 'ÉCHEC 2 : le livreur voit % tournée(s) au lieu d''une',
      v_list->'totals'->>'tournees';
  end if;
  if (v_list->'rows'->0->>'label') <> 'Tournée de Karim' then
    raise exception 'ÉCHEC 2 : il voit « % »', v_list->'rows'->0->>'label';
  end if;

  -- Celle de Sonia lui est refusée.
  begin
    perform public.get_delivery_round(v_i.sonia);
    raise exception 'ÉCHEC 2 : Karim a lu la tournée de Sonia';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- 3. La sienne lui donne de quoi livrer.
  v_plan := public.get_delivery_round(v_i.karim);
  v_passage := v_plan->'passages'->0;
  if v_passage->>'telephone' is null
     or v_passage->>'adresse' is null
     or v_passage->>'acces' is null then
    raise exception 'ÉCHEC 3 : le livreur n''a pas de quoi livrer %', v_passage;
  end if;

  -- 4. Mais pas le montant à encaisser.
  if v_passage ? 'a_encaisser' and v_passage->>'a_encaisser' is not null then
    raise exception 'ÉCHEC 4 : le livreur voit un montant à encaisser : %',
      v_passage->>'a_encaisser';
  end if;

  raise notice 'OK 2, 3 et 4 : sa tournée seulement, de quoi livrer, aucun montant.';
end $$;

-- ===========================================================================
-- 5, 6, 7. Ce que Karim peut faire, et ce qu'il ne peut pas
-- ===========================================================================
do $$
declare v_i record; v_res jsonb;
begin
  select * into v_i from ids;

  -- 5. Le passage de Sonia lui est refusé.
  begin
    perform public.record_round_stop_outcome(v_i.stop_sonia, 'livre');
    raise exception 'ÉCHEC 5 : Karim a soldé un passage de Sonia';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- 6. La tournée de Sonia ne démarre pas sous sa main.
  begin
    perform public.start_delivery_round(v_i.sonia);
    raise exception 'ÉCHEC 6 : Karim a démarré la tournée de Sonia';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- 7. Il ne compose rien.
  begin
    perform public.create_delivery_round(jsonb_build_object(
      'date', (current_date + 3)::text,
      'warehouse_id', (select argenteuil from t), 'label', 'Tournée pirate'));
    raise exception 'ÉCHEC 7 : un livreur a créé une tournée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.add_round_stop(v_i.karim, 'a4000000-0000-4000-a400-000000000002');
    raise exception 'ÉCHEC 7 : un livreur a ajouté un passage';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.reorder_round_stops(v_i.karim, array[v_i.stop_karim]);
    raise exception 'ÉCHEC 7 : un livreur a réordonné une tournée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.plan_delivery_round(v_i.karim);
    raise exception 'ÉCHEC 7 : un livreur a planifié une tournée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  -- Ni les écrans de pilotage.
  begin
    perform public.list_delivery_jobs('{}'::jsonb);
    raise exception 'ÉCHEC 7 : un livreur a lu la liste des dossiers';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Ce qu'il PEUT : démarrer et solder sa propre tournée.
  perform public.start_delivery_round(v_i.karim);
  v_res := public.record_round_stop_outcome(v_i.stop_karim, 'livre');
  if v_res->>'resultat' <> 'livre' or v_res->>'tournee' <> 'terminee' then
    raise exception 'ÉCHEC 5 : le livreur n''a pas pu solder sa tournée %', v_res;
  end if;

  raise notice 'OK 5, 6 et 7 : il exécute la sienne, il ne compose rien.';
end $$;
reset role;

-- ===========================================================================
-- 8. La consultation des coordonnées laisse une trace
-- ===========================================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.sensitive_access_logs
   where profile_id = 'a2000000-0000-4000-a200-000000000002'
     and action = 'consultation_coordonnees'
     and object_type = 'delivery_round';
  if v_n = 0 then
    raise exception 'ÉCHEC 8 : aucune trace de consultation des coordonnées';
  end if;
  -- Et aucune trace de montants, puisqu'il n'y a pas eu accès.
  select count(*) into v_n from public.sensitive_access_logs
   where profile_id = 'a2000000-0000-4000-a200-000000000002'
     and action = 'consultation_montants';
  if v_n <> 0 then
    raise exception 'ÉCHEC 8 : % trace(s) de consultation de montants pour un livreur', v_n;
  end if;
  raise notice 'OK 8 : consultation journalisée, montants absents du journal.';
end $$;

-- ===========================================================================
-- 9. Le responsable logistique garde sa vision globale
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a2000000-0000-4000-a200-000000000001';

do $$
declare v_i record; v_list jsonb; v_plan jsonb;
begin
  select * into v_i from ids;
  v_list := public.list_delivery_rounds('{}'::jsonb);
  if v_list->>'scope' <> 'global' then
    raise exception 'ÉCHEC 9 : portée « % » pour le responsable', v_list->>'scope';
  end if;
  if (v_list->'totals'->>'tournees')::int < 2 then
    raise exception 'ÉCHEC 9 : le responsable ne voit que % tournée(s)',
      v_list->'totals'->>'tournees';
  end if;
  -- Il lit les deux, y compris celle dont il n'est pas le livreur.
  v_plan := public.get_delivery_round(v_i.sonia);
  if v_plan->>'label' <> 'Tournée de Sonia' then
    raise exception 'ÉCHEC 9 : lecture croisée refusée au responsable';
  end if;
  -- Et il voit la colonne des montants, même vide faute de document Skara.
  if not (v_plan->'passages'->0 ? 'a_encaisser') then
    raise exception 'ÉCHEC 9 : le responsable ne reçoit pas la clé des montants';
  end if;
  raise notice 'OK 9 : vision globale intacte pour l''encadrement.';
end $$;
reset role;

rollback;
