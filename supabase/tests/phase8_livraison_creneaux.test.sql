-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 18 (disponibilité et créneaux, lot 2A)
--
-- Prouve, sur une base réelle :
--   1. un dossier SANS aucune ligne ne vaut jamais « complet » — le piège du
--      comptage sur ensemble vide, où « toutes les lignes sont prêtes » est
--      vrai et parfaitement faux ;
--   2. la disponibilité respecte le DÉPÔT : disponible à Argenteuil ne rend
--      pas livrable un dossier qui part d'Aubagne ;
--   3. autoriser le contact exige le droit de validation, que l'agent
--      logistique n'a pas ;
--   4. une disponibilité partielle n'est autorisée qu'explicitement, et le
--      dossier en garde la trace ;
--   5. aucun créneau ne se propose sans autorisation préalable ;
--   6. les créneaux refusent une date passée, un doublon et plus de cinq ;
--   7. confirmer un créneau fait tomber les autres et n'en laisse qu'un ;
--   8. un refus exige un motif et ramène le dossier à « prêt à contacter » ;
--   9. isolation : une autre organisation ne voit rien et ne peut rien.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000005', 'Organisation F (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('e1000000-0000-4000-e100-000000000001', 'resplog.creneaux@test.local'),
  ('e1000000-0000-4000-e100-000000000002', 'agent.creneaux@test.local'),
  ('e1000000-0000-4000-e100-000000000003', 'compta.creneaux@test.local'),
  ('e1000000-0000-4000-e100-000000000004', 'admin.autre.creneaux@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('e1000000-0000-4000-e100-000000000001', '00000000-0000-4000-a000-000000000001',
   'Resp. logistique créneaux', 'responsable_logistique'),
  ('e1000000-0000-4000-e100-000000000002', '00000000-0000-4000-a000-000000000001',
   'Agent logistique créneaux', 'logistique'),
  ('e1000000-0000-4000-e100-000000000003', '00000000-0000-4000-a000-000000000001',
   'Comptabilité créneaux', 'comptabilite'),
  ('e1000000-0000-4000-e100-000000000004', 'b0000000-0000-4000-b000-000000000005',
   'Admin autre org créneaux', 'administrateur');

-- ---------------------------------------------------------------------------
-- Jeu d'essai : quatre dossiers, un par situation de disponibilité.
-- ---------------------------------------------------------------------------
create temporary table t as
select
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Aubagne' limit 1) as aubagne;
grant all on t to authenticated;

do $$
declare v record;
begin
  select * into v from t;

  insert into public.logistics_lines (
    id, organization_id, origin, origin_reason, designation, quantity,
    stage, current_warehouse_id)
  values
    -- Dossier COMPLET : deux lignes disponibles à Argenteuil.
    ('e2000000-0000-4000-e200-00000000000a', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Canapé disponible', 1, 'disponible', v.argenteuil),
    ('e2000000-0000-4000-e200-00000000000b', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Table disponible', 1, 'disponible', v.argenteuil),
    -- Dossier PARTIEL : une disponible, une encore attendue.
    ('e2000000-0000-4000-e200-00000000000c', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Buffet disponible', 1, 'disponible', v.argenteuil),
    ('e2000000-0000-4000-e200-00000000000d', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Chaises attendues', 6, 'attendue', null),
    -- Dossier RIEN : une seule ligne, encore commandée.
    ('e2000000-0000-4000-e200-00000000000e', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Lit commandé', 1, 'commandee', null),
    -- Dossier MAUVAIS DÉPÔT : disponible, mais à Argenteuil.
    ('e2000000-0000-4000-e200-00000000000f', '00000000-0000-4000-a000-000000000001',
     'stock_local', 'test', 'Armoire disponible ailleurs', 1, 'disponible', v.argenteuil);

  insert into public.delivery_jobs (
    id, organization_id, reference, customer_name, customer_phone,
    address_line, city, postal_code, origin_warehouse_id, remise_type)
  values
    ('e3000000-0000-4000-e300-000000000001', '00000000-0000-4000-a000-000000000001',
     'LIV-COMPLET', 'Client Complet', '+33600000001',
     '1 rue du Test', 'Argenteuil', '95100', v.argenteuil, 'livraison_piece'),
    ('e3000000-0000-4000-e300-000000000002', '00000000-0000-4000-a000-000000000001',
     'LIV-PARTIEL', 'Client Partiel', '+33600000002',
     '2 rue du Test', 'Argenteuil', '95100', v.argenteuil, 'livraison_piece'),
    ('e3000000-0000-4000-e300-000000000003', '00000000-0000-4000-a000-000000000001',
     'LIV-RIEN', 'Client Rien', '+33600000003',
     '3 rue du Test', 'Argenteuil', '95100', v.argenteuil, 'livraison_piece'),
    ('e3000000-0000-4000-e300-000000000004', '00000000-0000-4000-a000-000000000001',
     'LIV-SANS-LIGNE', 'Client Sans Ligne', '+33600000004',
     '4 rue du Test', 'Argenteuil', '95100', v.argenteuil, 'livraison_piece'),
    ('e3000000-0000-4000-e300-000000000005', '00000000-0000-4000-a000-000000000001',
     'LIV-MAUVAIS-DEPOT', 'Client Aubagne', '+33600000005',
     '5 rue du Test', 'Aubagne', '13400', v.aubagne, 'livraison_piece');

  insert into public.delivery_allocations (
    organization_id, logistics_line_id, delivery_job_id, quantity_allocated)
  values
    ('00000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-e200-00000000000a',
     'e3000000-0000-4000-e300-000000000001', 1),
    ('00000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-e200-00000000000b',
     'e3000000-0000-4000-e300-000000000001', 1),
    ('00000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-e200-00000000000c',
     'e3000000-0000-4000-e300-000000000002', 1),
    ('00000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-e200-00000000000d',
     'e3000000-0000-4000-e300-000000000002', 6),
    ('00000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-e200-00000000000e',
     'e3000000-0000-4000-e300-000000000003', 1),
    -- Marchandise à Argenteuil, dossier qui part d'Aubagne.
    ('00000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-e200-00000000000f',
     'e3000000-0000-4000-e300-000000000005', 1);
end $$;

-- ===========================================================================
-- 1, 2. La disponibilité, calculée
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e100-000000000001';

do $$
declare v_d jsonb;
begin
  v_d := public.get_delivery_readiness('e3000000-0000-4000-e300-000000000001')->'disponibilite';
  if v_d->>'readiness' <> 'complet' or (v_d->>'lignes_pretes')::int <> 2 then
    raise exception 'ÉCHEC 1 : dossier complet mal évalué %', v_d;
  end if;

  v_d := public.get_delivery_readiness('e3000000-0000-4000-e300-000000000002')->'disponibilite';
  if v_d->>'readiness' <> 'partiel' or (v_d->>'lignes_manquantes')::int <> 1 then
    raise exception 'ÉCHEC 1 : dossier partiel mal évalué %', v_d;
  end if;

  v_d := public.get_delivery_readiness('e3000000-0000-4000-e300-000000000003')->'disponibilite';
  if v_d->>'readiness' <> 'rien_de_dispo' then
    raise exception 'ÉCHEC 1 : dossier sans disponibilité mal évalué %', v_d;
  end if;

  -- LE PIÈGE : aucune ligne affectée. « Toutes prêtes » serait vrai sur un
  -- ensemble vide, et absurde.
  v_d := public.get_delivery_readiness('e3000000-0000-4000-e300-000000000004')->'disponibilite';
  if v_d->>'readiness' <> 'sans_ligne' or (v_d->>'lignes_total')::int <> 0 then
    raise exception 'ÉCHEC 1 : un dossier vide passe pour prêt %', v_d;
  end if;

  -- Le dépôt compte : disponible à Argenteuil, dossier au départ d'Aubagne.
  v_d := public.get_delivery_readiness('e3000000-0000-4000-e300-000000000005')->'disponibilite';
  if v_d->>'readiness' <> 'rien_de_dispo' then
    raise exception 'ÉCHEC 2 : marchandise du mauvais dépôt comptée comme prête %', v_d;
  end if;

  raise notice 'OK 1 et 2 : disponibilité calculée, dépôt respecté, dossier vide refusé.';
end $$;
reset role;

-- ===========================================================================
-- 3. L'agent logistique prépare, il n'autorise pas
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e100-000000000002';

do $$
declare v_list jsonb;
begin
  -- Il voit bien la liste de travail.
  v_list := public.list_delivery_jobs('{}'::jsonb);
  if (v_list->'totals'->>'dossiers')::int < 5 then
    raise exception 'ÉCHEC 3 : l''agent ne voit pas les dossiers %', v_list->'totals';
  end if;
  if (v_list->'totals'->>'prets')::int <> 1 then
    raise exception 'ÉCHEC 3 : % dossier(s) prêt(s) au lieu de 1',
      v_list->'totals'->>'prets';
  end if;

  -- Mais il n'autorise pas le contact.
  begin
    perform public.authorize_delivery_contact('e3000000-0000-4000-e300-000000000001');
    raise exception 'ÉCHEC 3 : un agent sans droit de validation a autorisé le contact';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 3 : l''agent consulte, il ne valide pas.';
end $$;
reset role;

-- Un rôle sans « gerer_livraisons » ne lit même pas la liste.
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e100-000000000003';
do $$
begin
  begin
    perform public.list_delivery_jobs('{}'::jsonb);
    raise exception 'ÉCHEC 3 : la comptabilité a lu les dossiers de livraison';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end $$;
reset role;

-- ===========================================================================
-- 4, 5. Autorisation, partiel assumé, et la porte avant les créneaux
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e100-000000000001';

do $$
declare v_res jsonb; v_job public.delivery_jobs%rowtype;
begin
  -- Aucun créneau avant autorisation.
  begin
    perform public.propose_delivery_slots(
      'e3000000-0000-4000-e300-000000000001',
      jsonb_build_array(jsonb_build_object('date', (current_date + 7)::text, 'fenetre', 'matin')));
    raise exception 'ÉCHEC 5 : créneau proposé sans autorisation de contact';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Un dossier sans marchandise ne s'autorise pas.
  begin
    perform public.authorize_delivery_contact('e3000000-0000-4000-e300-000000000004');
    raise exception 'ÉCHEC 4 : contact autorisé sur un dossier sans marchandise';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Un dossier dont rien n'est disponible non plus.
  begin
    perform public.authorize_delivery_contact('e3000000-0000-4000-e300-000000000003');
    raise exception 'ÉCHEC 4 : contact autorisé sans aucune marchandise disponible';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Partiel : refusé tant qu'il n'est pas assumé.
  begin
    perform public.authorize_delivery_contact('e3000000-0000-4000-e300-000000000002');
    raise exception 'ÉCHEC 4 : disponibilité partielle autorisée sans le dire';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Partiel assumé : accepté, et tracé.
  v_res := public.authorize_delivery_contact(
    'e3000000-0000-4000-e300-000000000002', 'Client pressé, chaises plus tard.', true);
  if (v_res->>'partielle')::boolean is not true then
    raise exception 'ÉCHEC 4 : partiel non signalé en retour %', v_res;
  end if;
  select * into v_job from public.delivery_jobs
   where id = 'e3000000-0000-4000-e300-000000000002';
  if v_job.stage <> 'pret_a_contacter'
     or v_job.contact_authorized_at is null
     or v_job.contact_authorized_by <> 'e1000000-0000-4000-e100-000000000001'
     or not v_job.contact_authorized_partial then
    raise exception 'ÉCHEC 4 : autorisation partielle mal tracée (étape %, partiel %)',
      v_job.stage, v_job.contact_authorized_partial;
  end if;

  -- Complet : accepté sans rien assumer.
  v_res := public.authorize_delivery_contact('e3000000-0000-4000-e300-000000000001');
  if v_res->>'stage' <> 'pret_a_contacter' or (v_res->>'partielle')::boolean then
    raise exception 'ÉCHEC 4 : autorisation complète mal rendue %', v_res;
  end if;

  raise notice 'OK 4 et 5 : validation humaine tenue, partiel assumé, porte fermée avant elle.';
end $$;
reset role;

-- ===========================================================================
-- 6, 7, 8. Créneaux : propositions, confirmation, refus
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e100-000000000001';

do $$
declare
  v_res jsonb; v_job public.delivery_jobs%rowtype;
  v_slot uuid; v_count integer;
begin
  -- Date passée : refusée.
  begin
    perform public.propose_delivery_slots(
      'e3000000-0000-4000-e300-000000000001',
      jsonb_build_array(jsonb_build_object('date', (current_date - 1)::text)));
    raise exception 'ÉCHEC 6 : un créneau déjà passé a été accepté';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Doublon jour + fenêtre : refusé avec un message, pas par un index.
  begin
    perform public.propose_delivery_slots(
      'e3000000-0000-4000-e300-000000000001',
      jsonb_build_array(
        jsonb_build_object('date', (current_date + 7)::text, 'fenetre', 'matin'),
        jsonb_build_object('date', (current_date + 7)::text, 'fenetre', 'matin')));
    raise exception 'ÉCHEC 6 : deux fois le même créneau accepté';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Plus de cinq : refusé.
  begin
    perform public.propose_delivery_slots(
      'e3000000-0000-4000-e300-000000000001',
      (select jsonb_agg(jsonb_build_object('date', (current_date + i)::text, 'fenetre', 'journee'))
         from generate_series(7, 13) as i));
    raise exception 'ÉCHEC 6 : plus de cinq créneaux acceptés';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  -- Trois créneaux légitimes.
  v_res := public.propose_delivery_slots(
    'e3000000-0000-4000-e300-000000000001',
    jsonb_build_array(
      jsonb_build_object('date', (current_date + 7)::text, 'fenetre', 'matin', 'rang', 1),
      jsonb_build_object('date', (current_date + 7)::text, 'fenetre', 'apres_midi', 'rang', 2),
      jsonb_build_object('date', (current_date + 8)::text, 'fenetre', 'journee', 'rang', 3)),
    'Appel du jour.');
  if (v_res->>'creneaux_enregistres')::int <> 3
     or v_res->>'stage' <> 'contact_en_cours' then
    raise exception 'ÉCHEC 6 : propositions mal enregistrées %', v_res;
  end if;

  -- Reproposer remplace sans effacer : les anciennes deviennent caduques.
  perform public.propose_delivery_slots(
    'e3000000-0000-4000-e300-000000000001',
    jsonb_build_array(
      jsonb_build_object('date', (current_date + 10)::text, 'fenetre', 'matin', 'rang', 1),
      jsonb_build_object('date', (current_date + 11)::text, 'fenetre', 'matin', 'rang', 2)));
  select count(*) into v_count from public.delivery_slots
   where delivery_job_id = 'e3000000-0000-4000-e300-000000000001' and status = 'caduque';
  if v_count <> 3 then
    raise exception 'ÉCHEC 6 : % ancienne(s) proposition(s) caduque(s) au lieu de 3', v_count;
  end if;
  select count(*) into v_count from public.delivery_slots
   where delivery_job_id = 'e3000000-0000-4000-e300-000000000001' and status = 'proposee';
  if v_count <> 2 then
    raise exception 'ÉCHEC 6 : % proposition(s) vivante(s) au lieu de 2', v_count;
  end if;

  -- Le client choisit : les autres tombent, il n'en reste qu'un retenu.
  select id into v_slot from public.delivery_slots
   where delivery_job_id = 'e3000000-0000-4000-e300-000000000001'
     and status = 'proposee' and rank = 2;
  v_res := public.confirm_delivery_slot(v_slot, 'Confirmé au téléphone.');
  if v_res->>'stage' <> 'creneau_confirme' then
    raise exception 'ÉCHEC 7 : étape après confirmation : %', v_res->>'stage';
  end if;
  select count(*) into v_count from public.delivery_slots
   where delivery_job_id = 'e3000000-0000-4000-e300-000000000001' and status = 'retenue';
  if v_count <> 1 then
    raise exception 'ÉCHEC 7 : % créneau(x) retenu(s) au lieu d''un seul', v_count;
  end if;
  select count(*) into v_count from public.delivery_slots
   where delivery_job_id = 'e3000000-0000-4000-e300-000000000001' and status = 'proposee';
  if v_count <> 0 then
    raise exception 'ÉCHEC 7 : % proposition(s) survivante(s) après confirmation', v_count;
  end if;

  -- Un créneau déjà retenu ne se reconfirme pas.
  begin
    perform public.confirm_delivery_slot(v_slot);
    raise exception 'ÉCHEC 7 : un créneau retenu a été reconfirmé';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  raise notice 'OK 6 et 7 : créneaux contrôlés, confirmation exclusive.';
end $$;

-- Le refus : motif obligatoire, retour en arrière propre.
do $$
declare v_res jsonb; v_job public.delivery_jobs%rowtype; v_count integer;
begin
  perform public.propose_delivery_slots(
    'e3000000-0000-4000-e300-000000000002',
    jsonb_build_array(jsonb_build_object('date', (current_date + 9)::text, 'fenetre', 'matin')));

  begin
    perform public.decline_delivery_slots('e3000000-0000-4000-e300-000000000002', '   ');
    raise exception 'ÉCHEC 8 : refus accepté sans motif';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;

  v_res := public.decline_delivery_slots(
    'e3000000-0000-4000-e300-000000000002', 'Client injoignable après trois appels.');
  if (v_res->>'creneaux_refuses')::int <> 1
     or v_res->>'stage' <> 'pret_a_contacter' then
    raise exception 'ÉCHEC 8 : refus mal enregistré %', v_res;
  end if;
  select * into v_job from public.delivery_jobs
   where id = 'e3000000-0000-4000-e300-000000000002';
  if v_job.stage <> 'pret_a_contacter' then
    raise exception 'ÉCHEC 8 : étape après refus : %', v_job.stage;
  end if;
  -- L'autorisation reste acquise : inutile de revalider pour reproposer.
  if v_job.contact_authorized_at is null then
    raise exception 'ÉCHEC 8 : l''autorisation a été perdue au refus';
  end if;
  select count(*) into v_count from public.delivery_slots
   where delivery_job_id = 'e3000000-0000-4000-e300-000000000002' and status = 'refusee';
  if v_count <> 1 then
    raise exception 'ÉCHEC 8 : % créneau(x) refusé(s) au lieu de 1', v_count;
  end if;

  raise notice 'OK 8 : refus motivé, dossier rendu au contact, autorisation conservée.';
end $$;
reset role;

-- ===========================================================================
-- 9. Isolation interorganisation
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e100-000000000004';

do $$
declare v_list jsonb;
begin
  v_list := public.list_delivery_jobs('{}'::jsonb);
  if (v_list->'totals'->>'dossiers')::int <> 0 then
    raise exception 'ÉCHEC 9 : une autre organisation voit % dossier(s)',
      v_list->'totals'->>'dossiers';
  end if;
  begin
    perform public.get_delivery_readiness('e3000000-0000-4000-e300-000000000001');
    raise exception 'ÉCHEC 9 : lecture interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.authorize_delivery_contact('e3000000-0000-4000-e300-000000000003');
    raise exception 'ÉCHEC 9 : autorisation interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 9 : isolation tenue.';
end $$;
reset role;

rollback;
