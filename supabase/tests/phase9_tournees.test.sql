-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 19 (tournées de livraison, lot 2B)
--
-- Prouve, sur une base réelle :
--   1. un dossier sans date convenue n'entre pas dans une tournée ;
--   2. LA RÈGLE CENTRALE : la tournée du mardi refuse un client à qui on a
--      promis le lundi ;
--   3. un dossier d'un autre dépôt est refusé ;
--   4. un dossier dont la marchandise a disparu depuis la promesse est
--      refusé : elle a pu bouger entre l'appel et le chargement ;
--   5. un dossier ne figure pas dans deux tournées vivantes ;
--   6. la réorganisation de l'ordre exige une liste complète et sans doublon,
--      et l'échange de deux passages ne viole pas l'index ;
--   7. planifier exige un livreur et au moins un passage ;
--   8. une livraison sort la marchandise du stock et termine le dossier ;
--   9. un échec rend le dossier au contact et rend le créneau caduc — une
--      date manquée n'est plus une date ;
--  10. la tournée se referme seule au dernier passage traité ;
--  11. isolation : une autre organisation ne voit rien et ne peut rien.
--
-- Les tables étant VERROUILLÉES, les vérifications passent par les fonctions,
-- comme l'application. Le script se termine par un ROLLBACK.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000006', 'Organisation G (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('f1000000-0000-4000-f100-000000000001', 'resplog.tournee@test.local'),
  ('f1000000-0000-4000-f100-000000000002', 'livreur.tournee@test.local'),
  ('f1000000-0000-4000-f100-000000000003', 'admin.autre.tournee@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('f1000000-0000-4000-f100-000000000001', '00000000-0000-4000-a000-000000000001',
   'Resp. logistique tournée', 'responsable_logistique'),
  ('f1000000-0000-4000-f100-000000000002', '00000000-0000-4000-a000-000000000001',
   'Karim livreur', 'livreur'),
  ('f1000000-0000-4000-f100-000000000003', 'b0000000-0000-4000-b000-000000000006',
   'Admin autre org tournée', 'administrateur');

create temporary table t as
select
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Aubagne' limit 1) as aubagne,
  (current_date + 7)::date as lundi,
  (current_date + 8)::date as mardi;
grant all on t to authenticated;

-- Les tables étant verrouillées, un identifiant de tournée se transmet d'un
-- scénario à l'autre par une table temporaire, jamais par une lecture directe.
create temporary table ids (nord_lundi uuid);
insert into ids values (null);
grant all on ids to authenticated;

-- ---------------------------------------------------------------------------
-- Jeu d'essai. Cinq dossiers, tous avec de la marchandise disponible, et
-- des créneaux retenus posés directement : le lot 2A les a déjà prouvés.
-- ---------------------------------------------------------------------------
do $$
declare v record; i integer;
begin
  select * into v from t;

  for i in 1..5 loop
    insert into public.logistics_lines (
      id, organization_id, origin, origin_reason, designation, quantity,
      stage, current_warehouse_id)
    values (
      ('f2000000-0000-4000-f200-00000000000' || i)::uuid,
      '00000000-0000-4000-a000-000000000001', 'stock_local', 'test',
      'Marchandise ' || i, 1, 'disponible',
      case when i = 4 then v.aubagne else v.argenteuil end);
  end loop;

  insert into public.delivery_jobs (
    id, organization_id, reference, customer_name, customer_phone,
    address_line, city, postal_code, origin_warehouse_id, remise_type,
    stage, contact_authorized_at, contact_authorized_by)
  values
    -- 1 et 2 : promis LUNDI, dépôt Argenteuil. Tournée normale.
    ('f3000000-0000-4000-f300-000000000001', '00000000-0000-4000-a000-000000000001',
     'TOUR-LUNDI-1', 'Client Lundi 1', '+33600000011', '1 rue A', 'Argenteuil',
     '95100', v.argenteuil, 'livraison_piece', 'creneau_confirme', now(),
     'f1000000-0000-4000-f100-000000000001'),
    ('f3000000-0000-4000-f300-000000000002', '00000000-0000-4000-a000-000000000001',
     'TOUR-LUNDI-2', 'Client Lundi 2', '+33600000012', '2 rue A', 'Argenteuil',
     '95100', v.argenteuil, 'livraison_piece', 'creneau_confirme', now(),
     'f1000000-0000-4000-f100-000000000001'),
    -- 3 : promis MARDI. Ne doit pas entrer dans la tournée du lundi.
    ('f3000000-0000-4000-f300-000000000003', '00000000-0000-4000-a000-000000000001',
     'TOUR-MARDI', 'Client Mardi', '+33600000013', '3 rue A', 'Argenteuil',
     '95100', v.argenteuil, 'livraison_piece', 'creneau_confirme', now(),
     'f1000000-0000-4000-f100-000000000001'),
    -- 4 : promis lundi, mais part d'AUBAGNE.
    ('f3000000-0000-4000-f300-000000000004', '00000000-0000-4000-a000-000000000001',
     'TOUR-AUBAGNE', 'Client Aubagne', '+33600000014', '4 rue A', 'Aubagne',
     '13400', v.aubagne, 'livraison_piece', 'creneau_confirme', now(),
     'f1000000-0000-4000-f100-000000000001'),
    -- 5 : aucune date convenue avec le client.
    ('f3000000-0000-4000-f300-000000000005', '00000000-0000-4000-a000-000000000001',
     'TOUR-SANS-DATE', 'Client Sans Date', '+33600000015', '5 rue A', 'Argenteuil',
     '95100', v.argenteuil, 'livraison_piece', 'pret_a_contacter', now(),
     'f1000000-0000-4000-f100-000000000001');

  -- Alias explicite : « i » est déjà la variable de boucle de ce bloc, et
  -- PostgreSQL refuse à juste titre de deviner lequel des deux on vise.
  insert into public.delivery_allocations (
    organization_id, logistics_line_id, delivery_job_id, quantity_allocated)
  select '00000000-0000-4000-a000-000000000001',
         ('f2000000-0000-4000-f200-00000000000' || g.n)::uuid,
         ('f3000000-0000-4000-f300-00000000000' || g.n)::uuid,
         1
  from generate_series(1, 5) as g(n);

  -- Créneaux retenus : lundi pour 1, 2 et 4 ; mardi pour 3 ; rien pour 5.
  insert into public.delivery_slots (
    organization_id, delivery_job_id, slot_date, slot_window, status,
    proposed_by, answered_by, answered_at)
  values
    ('00000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-f300-000000000001',
     v.lundi, 'matin', 'retenue', 'f1000000-0000-4000-f100-000000000001',
     'f1000000-0000-4000-f100-000000000001', now()),
    ('00000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-f300-000000000002',
     v.lundi, 'apres_midi', 'retenue', 'f1000000-0000-4000-f100-000000000001',
     'f1000000-0000-4000-f100-000000000001', now()),
    ('00000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-f300-000000000003',
     v.mardi, 'matin', 'retenue', 'f1000000-0000-4000-f100-000000000001',
     'f1000000-0000-4000-f100-000000000001', now()),
    ('00000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-f300-000000000004',
     v.lundi, 'journee', 'retenue', 'f1000000-0000-4000-f100-000000000001',
     'f1000000-0000-4000-f100-000000000001', now());
end $$;

-- ===========================================================================
-- 1 à 5. Composer la tournée du lundi : ce qui entre et ce qui est refusé
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f100-000000000001';

do $$
declare
  v record; v_res jsonb; v_round uuid; v_autre uuid; v_cands jsonb;
begin
  select * into v from t;

  -- Une tournée dans le passé n'existe pas.
  begin
    perform public.create_delivery_round(jsonb_build_object(
      'date', (current_date - 1)::text, 'warehouse_id', v.argenteuil, 'label', 'Passé'));
    raise exception 'ÉCHEC : tournée créée dans le passé';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Sans nom non plus : c'est ce que le livreur lit.
  begin
    perform public.create_delivery_round(jsonb_build_object(
      'date', v.lundi::text, 'warehouse_id', v.argenteuil));
    raise exception 'ÉCHEC : tournée créée sans nom';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  v_res := public.create_delivery_round(jsonb_build_object(
    'date', v.lundi::text, 'warehouse_id', v.argenteuil,
    'label', 'Nord lundi', 'vehicle_label', 'Camion 1'));
  v_round := (v_res->>'id')::uuid;
  if v_res->>'stage' <> 'brouillon' then
    raise exception 'ÉCHEC : tournée créée à l''étape %', v_res->>'stage';
  end if;

  -- Les candidats du lundi au départ d'Argenteuil : les dossiers 1 et 2.
  v_cands := public.list_round_candidates(v.lundi, v.argenteuil);
  if jsonb_array_length(v_cands) <> 2 then
    raise exception 'ÉCHEC : % candidat(s) au lieu de 2 %',
      jsonb_array_length(v_cands), v_cands;
  end if;

  -- 1. Sans date convenue, pas de tournée.
  begin
    perform public.add_round_stop(v_round, 'f3000000-0000-4000-f300-000000000005');
    raise exception 'ÉCHEC 1 : dossier sans date convenue ajouté à une tournée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- 2. LA RÈGLE CENTRALE : promis mardi, tournée du lundi.
  begin
    perform public.add_round_stop(v_round, 'f3000000-0000-4000-f300-000000000003');
    raise exception 'ÉCHEC 2 : un client promis mardi est entré dans la tournée du lundi';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- 3. Mauvais dépôt.
  begin
    perform public.add_round_stop(v_round, 'f3000000-0000-4000-f300-000000000004');
    raise exception 'ÉCHEC 3 : dossier d''un autre dépôt ajouté';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Les deux dossiers légitimes entrent.
  v_res := public.add_round_stop(v_round, 'f3000000-0000-4000-f300-000000000001');
  if (v_res->>'position')::int <> 1 then
    raise exception 'ÉCHEC : première position = %', v_res->>'position';
  end if;
  v_res := public.add_round_stop(v_round, 'f3000000-0000-4000-f300-000000000002');
  if (v_res->>'position')::int <> 2 then
    raise exception 'ÉCHEC : deuxième position = %', v_res->>'position';
  end if;

  -- Ils ne sont plus candidats.
  if jsonb_array_length(public.list_round_candidates(v.lundi, v.argenteuil)) <> 0 then
    raise exception 'ÉCHEC : un dossier déjà prévu reste candidat';
  end if;

  -- 5. Pas deux tournées vivantes pour le même dossier.
  v_autre := (public.create_delivery_round(jsonb_build_object(
    'date', v.lundi::text, 'warehouse_id', v.argenteuil,
    'label', 'Sud lundi'))->>'id')::uuid;
  begin
    perform public.add_round_stop(v_autre, 'f3000000-0000-4000-f300-000000000001');
    raise exception 'ÉCHEC 5 : un dossier est entré dans deux tournées';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  raise notice 'OK 1 à 5 : date promise, dépôt et unicité tenus.';
end $$;
reset role;

-- ===========================================================================
-- 4. La marchandise a bougé depuis la promesse
-- ===========================================================================
-- La ligne du dossier 3 (promis mardi) repart en transfert : même avec la
-- bonne date, le dossier ne doit plus entrer dans une tournée.
update public.logistics_lines set stage = 'en_transfert'
 where id = 'f2000000-0000-4000-f200-000000000003';

set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f100-000000000001';
do $$
declare v record; v_mardi uuid;
begin
  select * into v from t;
  v_mardi := (public.create_delivery_round(jsonb_build_object(
    'date', v.mardi::text, 'warehouse_id', v.argenteuil,
    'label', 'Nord mardi'))->>'id')::uuid;
  begin
    perform public.add_round_stop(v_mardi, 'f3000000-0000-4000-f300-000000000003');
    raise exception 'ÉCHEC 4 : marchandise repartie en transfert, dossier quand même chargé';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 4 : marchandise revérifiée au moment du chargement.';
end $$;
reset role;

-- ===========================================================================
-- 6, 7. Ordre de passage et planification
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f100-000000000001';

do $$
declare
  v record; v_round uuid; v_plan jsonb; v_stops uuid[]; v_ordre jsonb;
begin
  select * into v from t;
  select (r->>'id')::uuid into v_round
  from jsonb_array_elements(public.list_delivery_rounds('{}'::jsonb)->'rows') r
  where r->>'label' = 'Nord lundi';

  v_plan := public.get_delivery_round(v_round);
  select array_agg((p->>'id')::uuid order by (p->>'position')::int) into v_stops
  from jsonb_array_elements(v_plan->'passages') p;

  -- Ordre partiel : refusé.
  begin
    perform public.reorder_round_stops(v_round, v_stops[1:1]);
    raise exception 'ÉCHEC 6 : ordre partiel accepté';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Doublon : refusé.
  begin
    perform public.reorder_round_stops(v_round, array[v_stops[1], v_stops[1]]);
    raise exception 'ÉCHEC 6 : ordre avec doublon accepté';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Échange des deux passages : l'index unique ne doit pas sauter.
  perform public.reorder_round_stops(v_round, array[v_stops[2], v_stops[1]]);
  v_ordre := public.get_delivery_round(v_round)->'passages';
  if (v_ordre->0->>'id')::uuid <> v_stops[2]
     or (v_ordre->1->>'id')::uuid <> v_stops[1] then
    raise exception 'ÉCHEC 6 : ordre non appliqué %', v_ordre;
  end if;

  -- 7. Planifier sans livreur : refusé.
  begin
    perform public.plan_delivery_round(v_round);
    raise exception 'ÉCHEC 7 : tournée planifiée sans livreur';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  raise notice 'OK 6 et 7 : ordre contrôlé, planification exigeante.';
end $$;
reset role;

-- Affectation du livreur, hors rôle applicatif : la table est verrouillée.
update public.delivery_rounds
   set driver_profile_id = 'f1000000-0000-4000-f100-000000000002'
 where label = 'Nord lundi';

-- Une tournée vide ne se planifie pas non plus.
update public.delivery_rounds
   set driver_profile_id = 'f1000000-0000-4000-f100-000000000002'
 where label = 'Sud lundi';

set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f100-000000000001';
do $$
declare v_vide uuid; v_round uuid; v_res jsonb;
begin
  select (r->>'id')::uuid into v_vide
  from jsonb_array_elements(public.list_delivery_rounds('{}'::jsonb)->'rows') r
  where r->>'label' = 'Sud lundi';
  begin
    perform public.plan_delivery_round(v_vide);
    raise exception 'ÉCHEC 7 : tournée sans passage planifiée';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  select (r->>'id')::uuid into v_round
  from jsonb_array_elements(public.list_delivery_rounds('{}'::jsonb)->'rows') r
  where r->>'label' = 'Nord lundi';
  v_res := public.plan_delivery_round(v_round);
  if v_res->>'stage' <> 'planifiee' or (v_res->>'passages')::int <> 2 then
    raise exception 'ÉCHEC 7 : planification mal rendue %', v_res;
  end if;

  -- Une tournée planifiée ne se replanifie pas.
  begin
    perform public.plan_delivery_round(v_round);
    raise exception 'ÉCHEC 7 : tournée replanifiée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  perform public.start_delivery_round(v_round);
  raise notice 'OK 7 : tournée planifiée puis démarrée.';
end $$;
reset role;

-- ===========================================================================
-- 8, 9, 10. Résultats de passage
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f100-000000000001';

do $$
declare
  v_round uuid; v_plan jsonb; v_livre uuid; v_echec uuid; v_res jsonb; v_d jsonb;
begin
  select (r->>'id')::uuid into v_round
  from jsonb_array_elements(public.list_delivery_rounds('{}'::jsonb)->'rows') r
  where r->>'label' = 'Nord lundi';
  v_plan := public.get_delivery_round(v_round);

  select (p->>'id')::uuid into v_livre from jsonb_array_elements(v_plan->'passages') p
   where p->>'reference' = 'TOUR-LUNDI-1';
  select (p->>'id')::uuid into v_echec from jsonb_array_elements(v_plan->'passages') p
   where p->>'reference' = 'TOUR-LUNDI-2';

  -- Un échec sans motif : refusé. Le client devra être rappelé.
  begin
    perform public.record_round_stop_outcome(v_echec, 'echec');
    raise exception 'ÉCHEC 9 : échec enregistré sans motif';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Résultat inconnu : refusé.
  begin
    perform public.record_round_stop_outcome(v_livre, 'peut_etre', 'bof');
    raise exception 'ÉCHEC 8 : résultat inconnu accepté';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- 8. Livré.
  v_res := public.record_round_stop_outcome(v_livre, 'livre');
  if v_res->>'resultat' <> 'livre' or (v_res->>'passages_restants')::int <> 1 then
    raise exception 'ÉCHEC 8 : livraison mal rendue %', v_res;
  end if;
  v_d := public.get_delivery_readiness('f3000000-0000-4000-f300-000000000001');
  if v_d->>'stage' <> 'termine' then
    raise exception 'ÉCHEC 8 : dossier à l''étape % après livraison', v_d->>'stage';
  end if;

  -- Un passage déjà soldé ne se resaisit pas.
  begin
    perform public.record_round_stop_outcome(v_livre, 'echec', 'erreur');
    raise exception 'ÉCHEC 8 : résultat réécrit';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- 9 et 10. Échec motivé : dossier rendu au contact, tournée refermée.
  v_res := public.record_round_stop_outcome(
    v_echec, 'echec', 'Personne au domicile, voisin absent.');
  if (v_res->>'passages_restants')::int <> 0
     or v_res->>'tournee' <> 'terminee' then
    raise exception 'ÉCHEC 10 : tournée non refermée au dernier passage %', v_res;
  end if;
  v_d := public.get_delivery_readiness('f3000000-0000-4000-f300-000000000002');
  if v_d->>'stage' <> 'pret_a_contacter' then
    raise exception 'ÉCHEC 9 : dossier à l''étape % après échec', v_d->>'stage';
  end if;
  -- La date promise ne vaut plus rien : plus aucun créneau retenu.
  if exists (select 1 from jsonb_array_elements(v_d->'creneaux') e
              where e->>'statut' = 'retenue') then
    raise exception 'ÉCHEC 9 : la date manquée est restée retenue';
  end if;

  raise notice 'OK 8, 9 et 10 : sortie de stock, échec motivé, tournée refermée.';
end $$;
reset role;

-- La marchandise livrée est sortie du stock : fait, pas état technique.
do $$
declare v_stage text; v_events integer;
begin
  select stage into v_stage from public.logistics_lines
   where id = 'f2000000-0000-4000-f200-000000000001';
  if v_stage <> 'sortie' then
    raise exception 'ÉCHEC 8 : ligne livrée à l''étape % au lieu de « sortie »', v_stage;
  end if;
  select count(*) into v_events from public.logistics_line_events
   where logistics_line_id = 'f2000000-0000-4000-f200-000000000001'
     and event_type = 'sortie';
  if v_events <> 1 then
    raise exception 'ÉCHEC 8 : % événement(s) de sortie au lieu d''un', v_events;
  end if;
end $$;

-- ===========================================================================
-- 11. Isolation interorganisation
-- ===========================================================================
update ids set nord_lundi = (select id from public.delivery_rounds
                              where label = 'Nord lundi');

set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f100-000000000003';

do $$
declare v_list jsonb; v_round uuid;
begin
  v_list := public.list_delivery_rounds('{}'::jsonb);
  if (v_list->'totals'->>'tournees')::int <> 0 then
    raise exception 'ÉCHEC 11 : une autre organisation voit % tournée(s)',
      v_list->'totals'->>'tournees';
  end if;
  select nord_lundi into v_round from ids;
  begin
    perform public.get_delivery_round(v_round);
    raise exception 'ÉCHEC 11 : lecture interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.add_round_stop(v_round, 'f3000000-0000-4000-f300-000000000001');
    raise exception 'ÉCHEC 11 : écriture interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 11 : isolation tenue.';
end $$;
reset role;

rollback;
