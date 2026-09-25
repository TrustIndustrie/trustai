-- ===========================================================================
-- TRUST AI — Tests du RÉCAPITULATIF GOOGLE SHEETS (phase 2)
--
-- Prouve, sur une base réelle :
--   * import idempotent (« ID TRUST » puis empreinte de secours) ;
--   * seconde synchronisation sans doublon ;
--   * modification d'une ligne existante ;
--   * disparition d'une ligne SANS suppression ;
--   * réception partielle et parcours Argenteuil → Aubagne ;
--   * destination ambiguë → anomalie ;
--   * séparation stricte des organisations ;
--   * autorisation par rôle ;
--   * refus d'accès direct aux tables ET aux fonctions internes.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Jeu d'essai : deux organisations, quatre profils
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000001', 'Organisation B (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-a000-000000000002', 'resplog.a@test.local'),
  ('a1000000-0000-4000-a000-000000000004', 'vendeuse.a@test.local'),
  ('a1000000-0000-4000-a000-000000000005', 'logistique.a@test.local'),
  ('b1000000-0000-4000-b000-000000000001', 'admin.b@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('a1000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
   'Resp. log. A', 'responsable_logistique'),
  ('a1000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
   'Vendeuse A', 'vendeur'),
  ('a1000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001',
   'Logisticien A', 'logistique'),
  ('b1000000-0000-4000-b000-000000000001', 'b0000000-0000-4000-b000-000000000001',
   'Admin B', 'administrateur');

-- Dépôts de l'organisation B (pour les tests d'isolation).
insert into public.warehouses (id, organization_id, name, city)
values ('b9000000-0000-4000-b000-000000000001',
        'b0000000-0000-4000-b000-000000000001', 'Dépôt B', 'Ville B');

-- ===========================================================================
-- TEST 1 — Configuration de la source : rôle exigé
-- ===========================================================================
set role authenticated;

-- Une vendeuse ne configure pas le récapitulatif.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000004';
do $$
begin
  perform public.upsert_recap_source('{"spreadsheet_id":"x","sheet_name":"RECAP"}'::jsonb);
  raise exception 'ECHEC : une vendeuse a pu configurer le récapitulatif';
exception when insufficient_privilege then
  raise notice 'TEST 1a OK — configuration refusée sans « importer_recap »';
end $$;

-- Le responsable logistique, oui.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_id uuid;
begin
  v_id := public.upsert_recap_source(jsonb_build_object(
    'label', 'Récapitulatif',
    'spreadsheet_id', '1AbCdEfGhIjKl',
    'sheet_name', 'RECAP',
    'header_row', 1,
    'id_column', 'ID TRUST',
    'column_mapping', jsonb_build_object('designation', 'DÉSIGNATION')));
  if v_id is null then raise exception 'ECHEC : source non créée'; end if;
  raise notice 'TEST 1b OK — source configurée par le responsable logistique';
end $$;

-- Deux enregistrements successifs ne créent pas deux sources.
-- La vérification se fait par la fonction serveur : les tables logistiques ne
-- sont PAS lisibles depuis une session utilisateur (c'est justement l'objet du
-- TEST 9).
do $$
declare v_source jsonb;
begin
  perform public.upsert_recap_source(jsonb_build_object(
    'label', 'Récapitulatif',
    'spreadsheet_id', '1AbCdEfGhIjKl',
    'sheet_name', 'RECAP',
    'header_row', 2));
  -- Depuis la migration 11 la configuration est une LISTE : plusieurs
  -- onglets peuvent coexister. Le MÊME onglet redéclaré met à jour la source
  -- existante — l'identité est le couple (classeur, onglet), plus le libellé.
  v_source := public.list_recap_sources();
  if jsonb_array_length(v_source) <> 1
     or (v_source->0->>'header_row')::int <> 2 then
    raise exception 'ECHEC : configuration non mise à jour (%)', v_source;
  end if;
  raise notice 'TEST 1c OK — la configuration est mise à jour';
end $$;
reset role;

-- Comptage réel, hors session utilisateur : une seule source existe.
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.recap_sources
  where organization_id = '00000000-0000-4000-a000-000000000001';
  if v_count <> 1 then
    raise exception 'ECHEC : % sources créées au lieu d''une', v_count;
  end if;
  raise notice 'TEST 1d OK — aucune source dupliquée';
end $$;

-- ---------------------------------------------------------------------------
-- Identifiants utiles pour la suite
-- ---------------------------------------------------------------------------
create temporary table t_ctx as
select
  (select id from public.recap_sources
   where organization_id = '00000000-0000-4000-a000-000000000001' limit 1) as source_id,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Aubagne' limit 1) as aubagne;

-- Table d'appoint du test : elle doit rester lisible depuis les sessions
-- utilisateur (elle ne contient aucune donnée métier, seulement des repères).
do $$
begin
  execute format('grant usage on schema %I to authenticated',
                 (select nspname from pg_namespace n
                  join pg_class c on c.relnamespace = n.oid
                  where c.relname = 't_ctx' and n.nspname like 'pg_temp%'));
end $$;
grant select on t_ctx to authenticated;

-- ===========================================================================
-- TEST 2 — Première synchronisation : création des lignes
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';

do $$
declare
  v_ctx record;
  v_report jsonb;
begin
  select * into v_ctx from t_ctx;

  v_report := public.sync_recap_rows(v_ctx.source_id, jsonb_build_array(
    -- 1) Ligne « Internet » avec ID TRUST et numéro de commande FOURNISSEUR.
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000001',
      'fingerprint', 'fp-internet', 'recap_date', '2026-08-05',
      'supplier_label', 'By Boo', 'supplier_reference', 'BB-EVA-CAR',
      'supplier_order_ref', 'WEB-88421',
      'designation', 'Canapé EVA XL caramel', 'quantity', 1,
      'customer_label', 'Dupont Marie', 'expected_at', '2026-09-20',
      'stage', 'commandee', 'destination_confidence', 'deduite',
      'raw_row', jsonb_build_object('ORDER', 'WEB-88421'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'arrivee_prevue', 'occurred_on', '2026-09-20')),
      'anomalies', '[]'::jsonb),
    -- 2) Parcours Argenteuil → Aubagne (transfert, une seule disponibilité).
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000003',
      'fingerprint', 'fp-aubagne', 'recap_date', '2026-06-03',
      'supplier_label', 'Eleonora', 'designation', 'Chaise Vera', 'quantity', 4,
      'customer_label', 'Bernard Sophie',
      'stage', 'disponible',
      'current_warehouse_id', v_ctx.aubagne,
      'destination_warehouse_id', v_ctx.aubagne,
      'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('MODE DE SORTIE', 'Marseille'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'reception_argenteuil',
                           'occurred_on', '2026-06-18', 'warehouse_id', v_ctx.argenteuil),
        jsonb_build_object('event_type', 'reception_aubagne',
                           'occurred_on', '2026-06-25', 'warehouse_id', v_ctx.aubagne)),
      'anomalies', '[]'::jsonb),
    -- 3) Réception partielle : ne devient pas disponible.
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000005',
      'fingerprint', 'fp-partielle',
      'supplier_label', 'SM', 'designation', 'Chaise Oslo', 'quantity', 4,
      'customer_label', 'Petit Julie',
      'stage', 'recue_argenteuil',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil,
      'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('COMMENTAIRES', 'partielle 2/4'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'reception_argenteuil',
                           'occurred_on', '2026-07-20', 'warehouse_id', v_ctx.argenteuil)),
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'reception_partielle', 'severity', 'avertissement',
        'message', 'Réception partielle 2 sur 4.'))),
    -- 4) Sans ID TRUST : identification par empreinte.
    jsonb_build_object(
      'ignored', false, 'fingerprint', 'fp-sans-id',
      'supplier_label', 'Polez', 'designation', 'Fauteuil Lisbonne', 'quantity', 1,
      'customer_label', 'Roux Camille',
      'stage', 'attendue', 'destination_confidence', 'ambigue',
      'raw_row', jsonb_build_object('MODE DE SORTIE', 'Entrepôt Nord'),
      'events', '[]'::jsonb,
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'destination_ambigue', 'severity', 'avertissement',
        'message', 'Destination non reconnue.'))),
    -- 5) Ligne écartée par le parseur (total).
    jsonb_build_object('ignored', true, 'fingerprint', '')
  ), 'manuel');

  if (v_report->>'created')::int <> 4 then
    raise exception 'ECHEC : % créées au lieu de 4', v_report->>'created';
  end if;
  if (v_report->>'ignored')::int <> 1 then
    raise exception 'ECHEC : ligne de total non ignorée';
  end if;
  if (v_report->>'anomalies')::int <> 2 then
    raise exception 'ECHEC : % anomalies au lieu de 2', v_report->>'anomalies';
  end if;
  raise notice 'TEST 2 OK — 4 lignes créées, 1 ignorée, 2 anomalies';
end $$;

-- Vérifications métier sur les lignes créées.
reset role;
do $$
declare v_ctx record; v_stage text; v_events integer;
begin
  select * into v_ctx from t_ctx;

  -- « ORDER » est bien le numéro FOURNISSEUR, pas la commande client.
  if (select supplier_order_ref from public.logistics_lines
      where recap_row_id = 'TR-000001') <> 'WEB-88421' then
    raise exception 'ECHEC : numéro de commande fournisseur non conservé';
  end if;

  -- Transfert : deux événements, UNE seule disponibilité, à Aubagne.
  select stage into v_stage from public.logistics_lines where recap_row_id = 'TR-000003';
  select count(*) into v_events from public.logistics_line_events e
  join public.logistics_lines l on l.id = e.logistics_line_id
  where l.recap_row_id = 'TR-000003';
  if v_stage <> 'disponible' then
    raise exception 'ECHEC : étape % pour la ligne transférée', v_stage;
  end if;
  if v_events <> 2 then
    raise exception 'ECHEC : % événements au lieu de 2', v_events;
  end if;
  if (select current_warehouse_id from public.logistics_lines
      where recap_row_id = 'TR-000003') <> v_ctx.aubagne then
    raise exception 'ECHEC : la marchandise devrait être à Aubagne';
  end if;

  -- Réception partielle : jamais disponible.
  select stage into v_stage from public.logistics_lines where recap_row_id = 'TR-000005';
  if v_stage = 'disponible' then
    raise exception 'ECHEC : une réception partielle a rendu la ligne disponible';
  end if;

  -- Destination ambiguë : anomalie enregistrée, aucune destination devinée.
  if (select destination_warehouse_id from public.logistics_lines
      where recap_row_fingerprint = 'fp-sans-id') is not null then
    raise exception 'ECHEC : une destination a été devinée';
  end if;
  if not exists (
    select 1 from public.logistics_anomalies a
    join public.logistics_lines l on l.id = a.logistics_line_id
    where l.recap_row_fingerprint = 'fp-sans-id' and a.type = 'destination_ambigue') then
    raise exception 'ECHEC : anomalie de destination non enregistrée';
  end if;

  raise notice 'TEST 2b OK — ORDER fournisseur, transfert, partielle et ambiguïté conformes';
end $$;

-- ===========================================================================
-- TEST 3 — Deuxième synchronisation : aucun doublon
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare
  v_ctx record;
  v_report jsonb;
begin
  select * into v_ctx from t_ctx;

  -- Exactement les mêmes lignes qu'à la première passe.
  v_report := public.sync_recap_rows(v_ctx.source_id, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000001', 'fingerprint', 'fp-internet',
      'recap_date', '2026-08-05', 'supplier_label', 'By Boo',
      'supplier_reference', 'BB-EVA-CAR', 'supplier_order_ref', 'WEB-88421',
      'designation', 'Canapé EVA XL caramel', 'quantity', 1,
      'customer_label', 'Dupont Marie', 'expected_at', '2026-09-20',
      'stage', 'commandee', 'destination_confidence', 'deduite',
      'raw_row', jsonb_build_object('ORDER', 'WEB-88421'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'arrivee_prevue', 'occurred_on', '2026-09-20')),
      'anomalies', '[]'::jsonb),
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000003', 'fingerprint', 'fp-aubagne',
      'recap_date', '2026-06-03', 'supplier_label', 'Eleonora',
      'designation', 'Chaise Vera', 'quantity', 4, 'customer_label', 'Bernard Sophie',
      'stage', 'disponible', 'current_warehouse_id', v_ctx.aubagne,
      'destination_warehouse_id', v_ctx.aubagne, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('MODE DE SORTIE', 'Marseille'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'reception_argenteuil',
                           'occurred_on', '2026-06-18', 'warehouse_id', v_ctx.argenteuil),
        jsonb_build_object('event_type', 'reception_aubagne',
                           'occurred_on', '2026-06-25', 'warehouse_id', v_ctx.aubagne)),
      'anomalies', '[]'::jsonb),
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000005', 'fingerprint', 'fp-partielle',
      'supplier_label', 'SM', 'designation', 'Chaise Oslo', 'quantity', 4,
      'customer_label', 'Petit Julie', 'stage', 'recue_argenteuil',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('COMMENTAIRES', 'partielle 2/4'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'reception_argenteuil',
                           'occurred_on', '2026-07-20', 'warehouse_id', v_ctx.argenteuil)),
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'reception_partielle', 'severity', 'avertissement',
        'message', 'Réception partielle 2 sur 4.'))),
    jsonb_build_object(
      'ignored', false, 'fingerprint', 'fp-sans-id',
      'supplier_label', 'Polez', 'designation', 'Fauteuil Lisbonne', 'quantity', 1,
      'customer_label', 'Roux Camille', 'stage', 'attendue',
      'destination_confidence', 'ambigue',
      'raw_row', jsonb_build_object('MODE DE SORTIE', 'Entrepôt Nord'),
      'events', '[]'::jsonb,
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'destination_ambigue', 'severity', 'avertissement',
        'message', 'Destination non reconnue.')))
  ), 'manuel');

  if (v_report->>'created')::int <> 0 then
    raise exception 'ECHEC : % ligne(s) recréée(s) à la 2e synchronisation',
      v_report->>'created';
  end if;
  if (v_report->>'unchanged')::int <> 4 then
    raise exception 'ECHEC : % inchangées au lieu de 4', v_report->>'unchanged';
  end if;

  raise notice 'TEST 3 OK — 2e synchronisation : 0 création';
end $$;

-- Comptages réels, hors session utilisateur.
reset role;
do $$
declare v_lines integer; v_events integer; v_anomalies integer;
begin
  select count(*) into v_lines from public.logistics_lines
  where organization_id = '00000000-0000-4000-a000-000000000001';
  select count(*) into v_events from public.logistics_line_events;
  select count(*) into v_anomalies from public.logistics_anomalies;
  if v_lines <> 4 then raise exception 'ECHEC : % lignes en base', v_lines; end if;
  if v_events <> 4 then raise exception 'ECHEC : % événements (doublons)', v_events; end if;
  if v_anomalies <> 2 then raise exception 'ECHEC : % anomalies (doublons)', v_anomalies; end if;
  raise notice 'TEST 3b OK — aucun doublon d''événement ni d''anomalie';
end $$;

-- ===========================================================================
-- TEST 4 — Modification d'une ligne existante
-- ===========================================================================
-- Repère d'horodatage pris hors session utilisateur.
create temporary table t_before as
select last_changed_at from public.logistics_lines where recap_row_id = 'TR-000001';

set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare
  v_ctx record;
  v_report jsonb;
begin
  select * into v_ctx from t_ctx;

  v_report := public.sync_recap_rows(v_ctx.source_id, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000001', 'fingerprint', 'fp-internet',
      'recap_date', '2026-08-05', 'supplier_label', 'By Boo',
      'supplier_reference', 'BB-EVA-CAR', 'supplier_order_ref', 'WEB-88421',
      -- La quantité passe de 1 à 2 et une arrivée est reçue.
      'designation', 'Canapé EVA XL caramel', 'quantity', 2,
      'customer_label', 'Dupont Marie', 'expected_at', '2026-09-20',
      'stage', 'recue_argenteuil',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_confidence', 'deduite',
      'raw_row', jsonb_build_object('ORDER', 'WEB-88421', 'QTÉ', '2'),
      'events', jsonb_build_array(
        jsonb_build_object('event_type', 'reception_argenteuil',
                           'occurred_on', '2026-09-18', 'warehouse_id', v_ctx.argenteuil)),
      'anomalies', '[]'::jsonb)
  ), 'manuel');

  if (v_report->>'updated')::int <> 1 then
    raise exception 'ECHEC : modification non détectée (%)', v_report->>'updated';
  end if;
  raise notice 'TEST 4 OK — modification détectée';
end $$;

reset role;
do $$
declare v_before timestamptz; v_after timestamptz;
begin
  select last_changed_at into v_before from t_before;
  select last_changed_at into v_after from public.logistics_lines
  where recap_row_id = 'TR-000001';
  if v_after <= v_before then
    raise exception 'ECHEC : last_changed_at non mis à jour';
  end if;
  if (select quantity from public.logistics_lines where recap_row_id = 'TR-000001') <> 2 then
    raise exception 'ECHEC : quantité non mise à jour';
  end if;
  -- La ligne source brute est conservée à jour.
  if (select raw_row->>'QTÉ' from public.logistics_lines
      where recap_row_id = 'TR-000001') <> '2' then
    raise exception 'ECHEC : ligne source brute non conservée';
  end if;
  -- Le nouvel événement s'ajoute sans écraser les précédents.
  if (select count(*) from public.logistics_line_events e
      join public.logistics_lines l on l.id = e.logistics_line_id
      where l.recap_row_id = 'TR-000001') <> 2 then
    raise exception 'ECHEC : historique des événements incomplet';
  end if;
  raise notice 'TEST 4b OK — quantité, ligne brute et historique conformes';
end $$;

-- ===========================================================================
-- TEST 5 — Disparition d'une ligne : signalée, JAMAIS supprimée
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_ctx record; v_report jsonb;
begin
  select * into v_ctx from t_ctx;
  -- Le fichier ne contient plus que TR-000001.
  v_report := public.sync_recap_rows(v_ctx.source_id, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000001', 'fingerprint', 'fp-internet',
      'designation', 'Canapé EVA XL caramel', 'quantity', 2,
      'customer_label', 'Dupont Marie', 'supplier_label', 'By Boo',
      'supplier_reference', 'BB-EVA-CAR', 'supplier_order_ref', 'WEB-88421',
      'recap_date', '2026-08-05', 'expected_at', '2026-09-20',
      'stage', 'recue_argenteuil', 'current_warehouse_id', v_ctx.argenteuil,
      'destination_confidence', 'deduite',
      'raw_row', jsonb_build_object('ORDER', 'WEB-88421', 'QTÉ', '2'),
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');

  if (v_report->>'missing')::int <> 3 then
    raise exception 'ECHEC : % lignes marquées absentes au lieu de 3', v_report->>'missing';
  end if;
  raise notice 'TEST 5 OK — 3 lignes signalées absentes';
end $$;

reset role;
do $$
declare v_count integer;
begin
  -- AUCUNE suppression : les 4 lignes existent toujours.
  select count(*) into v_count from public.logistics_lines
  where organization_id = '00000000-0000-4000-a000-000000000001';
  if v_count <> 4 then
    raise exception 'ECHEC : % lignes restantes — une suppression a eu lieu', v_count;
  end if;
  if (select missing_since from public.logistics_lines
      where recap_row_id = 'TR-000003') is null then
    raise exception 'ECHEC : ligne disparue non marquée';
  end if;
  if not exists (
    select 1 from public.logistics_anomalies a
    join public.logistics_lines l on l.id = a.logistics_line_id
    where l.recap_row_id = 'TR-000003'
      and a.type = 'ligne_absente_du_fichier' and a.resolved_at is null) then
    raise exception 'ECHEC : absence non signalée pour contrôle humain';
  end if;
  raise notice 'TEST 5b OK — aucune suppression, absence signalée';
end $$;

-- Le retour de la ligne dans le fichier lève le marquage d'absence.
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;
  perform public.sync_recap_rows(v_ctx.source_id, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-000003', 'fingerprint', 'fp-aubagne',
      'designation', 'Chaise Vera', 'quantity', 4, 'customer_label', 'Bernard Sophie',
      'supplier_label', 'Eleonora', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.aubagne, 'destination_warehouse_id', v_ctx.aubagne,
      'destination_confidence', 'sure', 'raw_row', '{}'::jsonb,
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');
end $$;

reset role;
do $$
begin
  if (select missing_since from public.logistics_lines
      where recap_row_id = 'TR-000003') is not null then
    raise exception 'ECHEC : marquage d''absence non levé au retour de la ligne';
  end if;
  raise notice 'TEST 5c OK — retour de la ligne : marquage d''absence levé';
end $$;

-- ===========================================================================
-- TEST 6 — Lecture : filtres, pagination, détail
-- ===========================================================================
-- Repères d'identifiants pris hors session utilisateur (les tables ne sont pas
-- lisibles depuis une session : c'est l'objet du TEST 9).
create temporary table t_ids as
select
  (select id from public.logistics_lines where recap_row_id = 'TR-000001') as ligne_1;
do $$
begin
  execute format('grant usage on schema %I to authenticated',
                 (select nspname from pg_namespace n
                  join pg_class c on c.relnamespace = n.oid
                  where c.relname = 't_ids' and n.nspname like 'pg_temp%'));
end $$;
grant select on t_ids to authenticated;

set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_page jsonb; v_detail jsonb; v_id uuid;
begin
  v_page := public.list_logistics_lines(null, null, null, null, false, 2, 0);
  if (v_page->>'total')::int <> 4 then
    raise exception 'ECHEC : total % au lieu de 4', v_page->>'total';
  end if;
  if jsonb_array_length(v_page->'rows') <> 2 then
    raise exception 'ECHEC : pagination non respectée';
  end if;

  -- Recherche par nom de client.
  v_page := public.list_logistics_lines('Bernard', null, null, null, false, 50, 0);
  if (v_page->>'total')::int <> 1 then
    raise exception 'ECHEC : recherche par client (% résultats)', v_page->>'total';
  end if;

  -- Filtre par étape.
  v_page := public.list_logistics_lines(null, 'disponible', null, null, false, 50, 0);
  if (v_page->>'total')::int <> 1 then
    raise exception 'ECHEC : filtre par étape';
  end if;

  -- Filtre anomalies.
  v_page := public.list_logistics_lines(null, null, null, null, true, 50, 0);
  if (v_page->>'total')::int < 1 then
    raise exception 'ECHEC : filtre anomalies vide';
  end if;

  -- Détail avec historique.
  select ligne_1 into v_id from t_ids;
  v_detail := public.get_logistics_line(v_id);
  if jsonb_array_length(v_detail->'events') < 2 then
    raise exception 'ECHEC : historique incomplet dans le détail';
  end if;
  raise notice 'TEST 6 OK — recherche, filtres, pagination et détail conformes';
end $$;
reset role;

-- ===========================================================================
-- TEST 7 — Séparation stricte des organisations
-- ===========================================================================
set role authenticated;

-- L'administrateur de B ne voit rien de A.
set local "request.jwt.claim.sub" = 'b1000000-0000-4000-b000-000000000001';
do $$
declare v_page jsonb; v_id uuid;
begin
  v_page := public.list_logistics_lines(null, null, null, null, false, 50, 0);
  if (v_page->>'total')::int <> 0 then
    raise exception 'ECHEC : l''organisation B voit % ligne(s) de A', v_page->>'total';
  end if;

  -- Même avec l'identifiant exact d'une ligne de A.
  select ligne_1 into v_id from t_ids;
  begin
    perform public.get_logistics_line(v_id);
    raise exception 'ECHEC : B a lu une ligne de A';
  exception when insufficient_privilege then null;
  end;

  -- Et la source de A n'est pas visible depuis B.
  if jsonb_array_length(public.list_recap_sources()) <> 0 then
    raise exception 'ECHEC : B voit la configuration de A';
  end if;
  raise notice 'TEST 7 OK — cloisonnement total entre organisations';
end $$;

-- Synchroniser la source de A depuis B est refusé.
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;
  begin
    perform public.sync_recap_rows(v_ctx.source_id, '[]'::jsonb, 'manuel');
    raise exception 'ECHEC : B a synchronisé la source de A';
  exception when insufficient_privilege then
    raise notice 'TEST 7b OK — synchronisation interorganisation refusée';
  end;
end $$;
reset role;

-- ===========================================================================
-- TEST 8 — Autorisations de lecture
-- ===========================================================================
set role authenticated;
-- Une vendeuse ne lit pas les lignes logistiques.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000004';
do $$
begin
  perform public.list_logistics_lines(null, null, null, null, false, 10, 0);
  raise exception 'ECHEC : une vendeuse a lu les lignes logistiques';
exception when insufficient_privilege then
  raise notice 'TEST 8a OK — lecture refusée à un rôle non logistique';
end $$;

-- Le rôle logistique lit, mais ne peut pas synchroniser.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000005';
do $$
declare v_ctx record; v_page jsonb;
begin
  v_page := public.list_logistics_lines(null, null, null, null, false, 10, 0);
  if (v_page->>'total')::int <> 4 then
    raise exception 'ECHEC : le rôle logistique devrait voir les 4 lignes';
  end if;
  select * into v_ctx from t_ctx;
  begin
    perform public.sync_recap_rows(v_ctx.source_id, '[]'::jsonb, 'manuel');
    raise exception 'ECHEC : synchronisation possible sans « importer_recap »';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TEST 8b OK — lecture autorisée, synchronisation réservée';
end $$;
reset role;

-- ===========================================================================
-- TEST 9 — Aucun accès direct aux tables ni aux fonctions internes
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare
  t text;
  v_ok boolean;
  v_echecs text := '';
begin
  foreach t in array array[
    'recap_sources','recap_reads','logistics_lines','logistics_line_events']
  loop
    v_ok := false;
    begin
      execute format('select 1 from public.%I limit 1', t);
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then v_echecs := v_echecs || t || ' '; end if;
  end loop;
  if v_echecs <> '' then
    raise exception 'ECHEC : lecture directe possible sur : %', v_echecs;
  end if;
  raise notice 'TEST 9a OK — aucune lecture directe des tables du récapitulatif';
end $$;

-- Fonctions INTERNES : inaccessibles même à un utilisateur authentifié.
do $$
declare
  v_ok boolean;
  v_echecs text := '';
begin
  v_ok := false;
  begin
    perform app.org_of('profile', '00000000-0000-0000-0000-000000000000');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then v_echecs := v_echecs || 'app.org_of '; end if;

  v_ok := false;
  begin
    perform app.payload_int('{}'::jsonb, 'x', 1, 2, 'x');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then v_echecs := v_echecs || 'app.payload_int '; end if;

  v_ok := false;
  begin
    perform app.last_correction_int('00000000-0000-0000-0000-000000000000', 'x');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then v_echecs := v_echecs || 'app.last_correction_int '; end if;

  if v_echecs <> '' then
    raise exception 'ECHEC : fonctions internes appelables directement : %', v_echecs;
  end if;
  raise notice 'TEST 9b OK — fonctions internes inaccessibles depuis une session';
end $$;

-- Les RPC publiques autorisées continuent de fonctionner normalement.
do $$
declare v_page jsonb; v_summary jsonb;
begin
  v_page := public.list_logistics_lines(null, null, null, null, false, 5, 0);
  if v_page is null then raise exception 'ECHEC : list_logistics_lines cassée'; end if;
  v_summary := public.logistics_summary();
  if (v_summary->>'lignes_total')::int <> 4 then
    raise exception 'ECHEC : logistics_summary incohérent';
  end if;
  if jsonb_array_length(public.list_recap_sources()) <> 1 then
    raise exception 'ECHEC : list_recap_sources cassée';
  end if;
  raise notice 'TEST 9c OK — les RPC publiques fonctionnent (les déclencheurs aussi)';
end $$;
reset role;

rollback;

\echo 'TOUS LES TESTS PHASE 2 SONT PASSES (transaction annulée, base intacte).'
