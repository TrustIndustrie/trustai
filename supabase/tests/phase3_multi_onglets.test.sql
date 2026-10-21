-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 11 (plusieurs onglets, trois sorties)
--
-- Prouve, sur une base réelle :
--   * deux onglets du même classeur = deux sources indépendantes ;
--   * le même onglet redéclaré met à jour, ne duplique pas ;
--   * les trois chemins de sortie sont enregistrés et distingués ;
--   * une sortie déjà constatée n'est jamais effacée par une relecture ;
--   * l'affrètement est conservé et cherchable ;
--   * la liste des transporteurs est stockée par source ;
--   * la mise en sommeil d'une source ne détruit aucune ligne ;
--   * filtres par onglet et par chemin de sortie ;
--   * isolation stricte entre organisations, y compris sur les nouvelles RPC.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Jeu d'essai
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000001', 'Organisation B (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-a000-000000000002', 'resplog.a@test.local'),
  ('a1000000-0000-4000-a000-000000000004', 'vendeuse.a@test.local'),
  ('b1000000-0000-4000-b000-000000000001', 'admin.b@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('a1000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001',
   'Resp. log. A', 'responsable_logistique'),
  ('a1000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001',
   'Vendeuse A', 'vendeur'),
  ('b1000000-0000-4000-b000-000000000001', 'b0000000-0000-4000-b000-000000000001',
   'Admin B', 'administrateur');

-- ===========================================================================
-- TEST 1 — Deux onglets du même classeur = deux sources
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';

do $$
declare
  v_internet uuid;
  v_2025 uuid;
  v_sources jsonb;
begin
  -- L'onglet de l'année en cours.
  v_internet := public.upsert_recap_source(jsonb_build_object(
    'label', 'Récapitulatif Internet',
    'spreadsheet_id', '1kF66classeur',
    'sheet_name', 'INTERNET',
    'header_row', 4,
    'id_column', 'ID TRUST',
    'column_mapping', jsonb_build_object(
      'recap_date', 'A', 'designation', 'E', 'customer_label', 'G',
      'comments', 'J', 'comments_2', 'N'),
    'client_carriers', jsonb_build_array('OMAR', 'GEODIS', 'GUISNEL')));

  -- L'onglet de l'année précédente, MÊME classeur.
  v_2025 := public.upsert_recap_source(jsonb_build_object(
    'label', 'Récapitulatif 2025',
    'spreadsheet_id', '1kF66classeur',
    'sheet_name', 'SUIVIS 2025',
    'header_row', 4,
    'id_column', 'ID TRUST',
    'column_mapping', jsonb_build_object('recap_date', 'A', 'designation', 'E'),
    'client_carriers', jsonb_build_array('OMAR', 'GEODIS', 'DEFITRANS', 'COCOLIS')));

  if v_internet = v_2025 then
    raise exception 'ECHEC : les deux onglets partagent la même source';
  end if;

  v_sources := public.list_recap_sources();
  if jsonb_array_length(v_sources) <> 2 then
    raise exception 'ECHEC : % source(s) au lieu de 2', jsonb_array_length(v_sources);
  end if;
  raise notice 'TEST 1 OK — deux onglets, deux sources indépendantes';
end $$;

-- Redéclarer le MÊME onglet met à jour, ne duplique pas.
do $$
declare v_sources jsonb; v_first jsonb;
begin
  perform public.upsert_recap_source(jsonb_build_object(
    'label', 'Récapitulatif Internet (renommé)',
    'spreadsheet_id', '1kF66classeur',
    'sheet_name', 'INTERNET',
    'header_row', 4,
    'client_carriers', jsonb_build_array('OMAR', 'GEODIS', 'GUISNEL', 'DEFITRANS')));

  v_sources := public.list_recap_sources();
  if jsonb_array_length(v_sources) <> 2 then
    raise exception 'ECHEC : redéclarer un onglet a créé une source de plus';
  end if;
  select value into v_first from jsonb_array_elements(v_sources) as value
  where value->>'sheet_name' = 'INTERNET';
  if v_first->>'label' <> 'Récapitulatif Internet (renommé)' then
    raise exception 'ECHEC : libellé non mis à jour';
  end if;
  if jsonb_array_length(v_first->'client_carriers') <> 4 then
    raise exception 'ECHEC : transporteurs non mis à jour (%)', v_first->'client_carriers';
  end if;
  raise notice 'TEST 1b OK — même onglet : mise à jour, jamais duplication';
end $$;

-- Le libellé n'identifie plus rien : deux onglets peuvent le partager.
do $$
begin
  perform public.upsert_recap_source(jsonb_build_object(
    'label', 'Récapitulatif Internet (renommé)',
    'spreadsheet_id', '1kF66classeur',
    'sheet_name', 'SUIVIS 2024',
    'header_row', 4));
  if jsonb_array_length(public.list_recap_sources()) <> 3 then
    raise exception 'ECHEC : un libellé partagé a été refusé';
  end if;
  raise notice 'TEST 1c OK — le libellé est décoratif, il n''identifie plus';
end $$;
reset role;

-- ---------------------------------------------------------------------------
create temporary table t_ctx as
select
  (select id from public.recap_sources
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and sheet_name = 'INTERNET') as internet,
  (select id from public.recap_sources
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and sheet_name = 'SUIVIS 2025') as an_2025,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Aubagne' limit 1) as aubagne;

do $$
begin
  execute format('grant usage on schema %I to authenticated',
                 (select nspname from pg_namespace n
                  join pg_class c on c.relnamespace = n.oid
                  where c.relname = 't_ctx' and n.nspname like 'pg_temp%'));
end $$;
grant select on t_ctx to authenticated;

-- ===========================================================================
-- TEST 2 — Les trois chemins de sortie
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';

do $$
declare v_ctx record; v_report jsonb;
begin
  select * into v_ctx from t_ctx;

  v_report := public.sync_recap_rows(v_ctx.internet, jsonb_build_array(
    -- 1) Servie par Paris.
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-A1', 'fingerprint', 'fp-a1',
      'recap_date', '2026-01-02', 'supplier_label', 'POLEZ',
      'designation', 'EVA 2 BLOCS VITO TAUPE', 'quantity', 1,
      'customer_label', 'Client Bravo', 'stage', 'sortie',
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'exit_channel', 'paris', 'exit_at', '2026-01-13',
      'raw_row', jsonb_build_object('EXPEDITEUR', 'OMAR'),
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb),
    -- 2) Livrée depuis Aubagne, avec numéro d'affrètement.
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-A2', 'fingerprint', 'fp-a2',
      'recap_date', '2026-01-06', 'supplier_label', 'SM',
      'designation', 'TABLE REPAS AIKIN', 'quantity', 1,
      'customer_label', 'Client Echo', 'stage', 'sortie',
      'destination_warehouse_id', v_ctx.aubagne, 'destination_confidence', 'sure',
      'exit_channel', 'livraison_aubagne', 'exit_at', '2026-04-03',
      'freight_ref', 'E244',
      'raw_row', jsonb_build_object('EXPEDITEUR', 'LIVRAISON AUBAGNE'),
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb),
    -- 3) Retirée sur place à Aubagne.
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-A3', 'fingerprint', 'fp-a3',
      'recap_date', '2026-01-07', 'supplier_label', 'POLEZ',
      'designation', 'MATELAS BARCELONE', 'quantity', 1,
      'customer_label', 'Client Foxtrot', 'stage', 'sortie',
      'destination_warehouse_id', v_ctx.aubagne, 'destination_confidence', 'sure',
      'exit_channel', 'retrait_aubagne', 'exit_at', '2026-02-02',
      'raw_row', '{}'::jsonb, 'events', '[]'::jsonb, 'anomalies', '[]'::jsonb),
    -- 4) Encore en transfert : affrètement, pas encore sortie.
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-A4', 'fingerprint', 'fp-a4',
      'recap_date', '2026-01-05', 'supplier_label', 'BY BOO',
      'designation', 'FAUTEUIL HUG', 'quantity', 1,
      'customer_label', 'Client Delta', 'stage', 'en_transfert',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.aubagne, 'destination_confidence', 'deduite',
      'freight_ref', 'E243',
      'raw_row', '{}'::jsonb, 'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');

  if (v_report->>'created')::int <> 4 then
    raise exception 'ECHEC : % créées au lieu de 4', v_report->>'created';
  end if;
  raise notice 'TEST 2 OK — 4 lignes créées sur l''onglet INTERNET';
end $$;

reset role;
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;

  if (select exit_channel from public.logistics_lines where recap_row_id = 'TR-A1')
     <> 'paris' then
    raise exception 'ECHEC : chemin de sortie Paris non enregistré';
  end if;
  if (select exit_at from public.logistics_lines where recap_row_id = 'TR-A2')
     <> date '2026-04-03' then
    raise exception 'ECHEC : date de livraison Aubagne non enregistrée';
  end if;
  if (select exit_channel from public.logistics_lines where recap_row_id = 'TR-A3')
     <> 'retrait_aubagne' then
    raise exception 'ECHEC : retrait sur place non enregistré';
  end if;
  -- AUCUNE ligne sortie ne doit être annoncée disponible.
  if exists (
    select 1 from public.logistics_lines
    where exit_channel is not null and stage = 'disponible') then
    raise exception 'ECHEC : une ligne sortie est annoncée disponible';
  end if;
  -- L'affrètement est conservé des deux côtés du transfert.
  if (select freight_ref from public.logistics_lines where recap_row_id = 'TR-A4')
     <> 'E243' then
    raise exception 'ECHEC : numéro d''affrètement perdu';
  end if;
  raise notice 'TEST 2b OK — trois chemins distingués, affrètement conservé';
end $$;

-- ===========================================================================
-- TEST 3 — Une sortie constatée n'est jamais effacée
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;
  -- Le fichier est corrigé : la colonne de sortie a été vidée par erreur.
  perform public.sync_recap_rows(v_ctx.internet, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-A1', 'fingerprint', 'fp-a1',
      'recap_date', '2026-01-02', 'supplier_label', 'POLEZ',
      'designation', 'EVA 2 BLOCS VITO TAUPE', 'quantity', 1,
      'customer_label', 'Client Bravo', 'stage', 'disponible',
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', '{}'::jsonb, 'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');
end $$;

reset role;
do $$
begin
  if (select exit_channel from public.logistics_lines where recap_row_id = 'TR-A1')
     is distinct from 'paris' then
    raise exception 'ECHEC : une sortie constatée a été effacée par une relecture';
  end if;
  if (select stage from public.logistics_lines where recap_row_id = 'TR-A1') <> 'sortie' then
    raise exception 'ECHEC : une ligne sortie est redevenue disponible';
  end if;
  raise notice 'TEST 3 OK — la marchandise partie ne revient pas en stock';
end $$;

-- ===========================================================================
-- TEST 4 — Les onglets ne se mélangent pas
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_ctx record; v_report jsonb; v_page jsonb;
begin
  select * into v_ctx from t_ctx;

  -- Même « ID TRUST » que sur l'autre onglet : ce doit être une AUTRE ligne.
  v_report := public.sync_recap_rows(v_ctx.an_2025, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-A1', 'fingerprint', 'fp-a1',
      'recap_date', '2025-03-04', 'supplier_label', 'ELEONORA',
      'designation', 'CHAISE VERA', 'quantity', 2,
      'customer_label', 'Client 2025', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', '{}'::jsonb, 'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');

  if (v_report->>'created')::int <> 1 then
    raise exception 'ECHEC : la ligne de 2025 n''a pas été créée (%)', v_report;
  end if;

  -- La synchronisation de 2025 ne doit RIEN marquer d'absent sur INTERNET.
  if (v_report->>'missing')::int <> 0 then
    raise exception 'ECHEC : % ligne(s) d''un autre onglet marquée(s) absente(s)',
      v_report->>'missing';
  end if;

  -- Filtre par onglet.
  v_page := public.list_logistics_lines(
    null, null, null, null, false, 50, 0, v_ctx.an_2025, null);
  if (v_page->>'total')::int <> 1 then
    raise exception 'ECHEC : filtre par onglet (% résultats)', v_page->>'total';
  end if;
  v_page := public.list_logistics_lines(
    null, null, null, null, false, 50, 0, v_ctx.internet, null);
  if (v_page->>'total')::int <> 4 then
    raise exception 'ECHEC : filtre par onglet INTERNET (% résultats)', v_page->>'total';
  end if;

  -- Filtre par chemin de sortie.
  v_page := public.list_logistics_lines(
    null, null, null, null, false, 50, 0, null, 'retrait_aubagne');
  if (v_page->>'total')::int <> 1 then
    raise exception 'ECHEC : filtre par chemin de sortie';
  end if;

  -- Recherche par numéro d'affrètement.
  v_page := public.list_logistics_lines('E243', null, null, null, false, 50, 0, null, null);
  if (v_page->>'total')::int <> 1 then
    raise exception 'ECHEC : recherche par affrètement (% résultats)', v_page->>'total';
  end if;

  raise notice 'TEST 4 OK — onglets cloisonnés, filtres et recherche conformes';
end $$;

-- ===========================================================================
-- TEST 5 — Mise en sommeil : aucune ligne détruite
-- ===========================================================================
do $$
declare v_ctx record; v_sources jsonb; v_src jsonb;
begin
  select * into v_ctx from t_ctx;
  perform public.set_recap_source_active(v_ctx.an_2025, false);

  v_sources := public.list_recap_sources();
  select value into v_src from jsonb_array_elements(v_sources) as value
  where value->>'sheet_name' = 'SUIVIS 2025';
  if (v_src->>'active')::boolean then
    raise exception 'ECHEC : source toujours active';
  end if;
  if (v_src->>'lines_count')::int <> 1 then
    raise exception 'ECHEC : les lignes de la source ont disparu (%)', v_src->>'lines_count';
  end if;
  raise notice 'TEST 5 OK — source en sommeil, lignes conservées';
end $$;
reset role;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.logistics_lines
  where organization_id = '00000000-0000-4000-a000-000000000001';
  if v_count <> 5 then
    raise exception 'ECHEC : % lignes au lieu de 5 après mise en sommeil', v_count;
  end if;
  raise notice 'TEST 5b OK — 5 lignes toujours en base';
end $$;

-- ===========================================================================
-- TEST 6 — Isolation entre organisations sur les NOUVELLES fonctions
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'b1000000-0000-4000-b000-000000000001';
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;

  if jsonb_array_length(public.list_recap_sources()) <> 0 then
    raise exception 'ECHEC : B voit les onglets de A';
  end if;

  begin
    perform public.set_recap_source_active(v_ctx.internet, false);
    raise exception 'ECHEC : B a mis en sommeil une source de A';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.upsert_recap_source(jsonb_build_object(
      'id', v_ctx.internet, 'spreadsheet_id', 'x', 'sheet_name', 'y'));
    raise exception 'ECHEC : B a modifié la configuration de A';
  exception when insufficient_privilege then null;
  end;

  if (public.list_logistics_lines(
        null, null, null, null, false, 50, 0, v_ctx.internet, null)->>'total')::int <> 0 then
    raise exception 'ECHEC : B lit les lignes de A par filtre d''onglet';
  end if;

  raise notice 'TEST 6 OK — cloisonnement total sur les nouvelles fonctions';
end $$;

-- Une vendeuse ne configure toujours rien.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000004';
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;
  begin
    perform public.set_recap_source_active(v_ctx.internet, false);
    raise exception 'ECHEC : une vendeuse a modifié une source';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_recap_sources();
    raise exception 'ECHEC : une vendeuse a lu la configuration';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TEST 6b OK — rôle sans « importer_recap » : tout refusé';
end $$;
reset role;

-- ===========================================================================
-- TEST 7 — Un chemin de sortie inconnu est REFUSÉ
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_ctx record;
begin
  select * into v_ctx from t_ctx;
  begin
    perform public.sync_recap_rows(v_ctx.internet, jsonb_build_array(
      jsonb_build_object(
        'ignored', false, 'recap_row_id', 'TR-A9', 'fingerprint', 'fp-a9',
        'designation', 'Article', 'quantity', 1, 'stage', 'sortie',
        'exit_channel', 'par_la_fenetre',
        'raw_row', '{}'::jsonb, 'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
    ), 'manuel');
    raise exception 'ECHEC : un chemin de sortie inventé a été accepté';
  exception when others then
    if sqlerrm like 'ECHEC%' then raise; end if;
    raise notice 'TEST 7 OK — chemin de sortie inconnu refusé';
  end;
end $$;
reset role;

-- ===========================================================================
-- TEST 8 — Aucun accès direct aux nouvelles colonnes ni fonctions
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_ok boolean := false;
begin
  begin
    perform exit_channel from public.logistics_lines limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception 'ECHEC : lecture directe de logistics_lines possible';
  end if;

  v_ok := false;
  begin
    perform client_carriers from public.recap_sources limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception 'ECHEC : lecture directe de recap_sources possible';
  end if;
  raise notice 'TEST 8 OK — les nouvelles colonnes restent inaccessibles en direct';
end $$;
reset role;

do $$
declare v_count integer;
begin
  select count(*) into v_count from information_schema.routine_privileges
  where routine_schema = 'public'
    and grantee in ('anon', 'PUBLIC')
    and routine_name in ('list_recap_sources', 'upsert_recap_source',
                         'set_recap_source_active', 'sync_recap_rows',
                         'list_logistics_lines', 'get_logistics_line');
  if v_count <> 0 then
    raise exception 'ECHEC : % droit(s) d''exécution ouverts à anon/PUBLIC', v_count;
  end if;
  raise notice 'TEST 8b OK — aucune RPC ouverte à anon ni à PUBLIC';
end $$;

rollback;

\echo 'TOUS LES TESTS PHASE 3 SONT PASSES (transaction annulée, base intacte).'
