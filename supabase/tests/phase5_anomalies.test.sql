-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 13 (résolution des anomalies)
--
-- Prouve, sur une base réelle :
--   1. une anomalie recalculée depuis le fichier se ferme TOUTE SEULE quand
--      sa cause disparaît, avec une trace « fermeture_automatique » ;
--   2. une anomalie MANUELLE n'est jamais fermée par la synchronisation ;
--   3. une décision humaine tient tant que la ligne source ne change pas,
--      et l'anomalie renaît si le contenu change ;
--   4. permissions : le rôle « logistique » consulte mais ne tranche pas,
--      une autre organisation ne voit rien, une note est obligatoire ;
--   5. réouverture tracée, et une décision ne se modifie pas (ajout seul) ;
--   6. avec la migration 12 : une ligne bloquée redevient affectable une fois
--      l'anomalie tranchée ;
--   7. la ligne absente revenue ferme son anomalie « absente » ;
--   8. aucune lecture directe de l'historique des décisions.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000001', 'Organisation B (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('e1000000-0000-4000-e000-000000000001', 'resplog.e@test.local'),
  ('e1000000-0000-4000-e000-000000000002', 'logistique.e@test.local'),
  ('e1000000-0000-4000-e000-000000000003', 'admin.e.b@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('e1000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Resp. log. E', 'responsable_logistique'),
  ('e1000000-0000-4000-e000-000000000002', '00000000-0000-4000-a000-000000000001',
   'Logistique E', 'logistique'),
  ('e1000000-0000-4000-e000-000000000003', 'b0000000-0000-4000-b000-000000000001',
   'Admin E (B)', 'administrateur');

create temporary table ctx as
select
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil,
  null::uuid as source,
  null::uuid as line,
  null::uuid as anomaly;
grant all on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- Source et première lecture : une ligne DISPONIBLE avec une annulation
-- signalée (anomalie BLOQUANTE recalculée depuis le fichier).
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e000-000000000001';

do $$
declare v_ctx record; v_src uuid;
begin
  select * into v_ctx from ctx;
  v_src := public.upsert_recap_source(jsonb_build_object(
    'label', 'Phase 5', 'spreadsheet_id', '1phase5', 'sheet_name', 'INTERNET',
    'header_row', 4, 'id_column', 'ID TRUST',
    'column_mapping', jsonb_build_object('recap_date', 'A', 'designation', 'E'),
    'client_carriers', jsonb_build_array('OMAR')));

  perform public.sync_recap_rows(v_src, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-E1', 'fingerprint', 'fp-e1',
      'recap_date', '2026-02-01', 'designation', 'CANAPE ANNULE', 'quantity', 1,
      'customer_label', 'Client E', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('J', 'ANNULER FRAUDE'),
      'events', '[]'::jsonb,
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'annulation_signalee', 'severity', 'bloquant',
        'message', 'Annulation signalée.')))
  ), 'manuel');
  update ctx set source = v_src;
end $$;

reset role;
do $$
declare v_ctx record; v_a record; v_line uuid;
begin
  select * into v_ctx from ctx;
  select id into v_line from public.logistics_lines
  where source_id = v_ctx.source and recap_row_id = 'TR-E1';
  update ctx set line = v_line;
  select * into v_a from public.logistics_anomalies
  where logistics_line_id = v_line and type = 'annulation_signalee';
  if v_a.origin <> 'synchronisation' or v_a.resolved_at is not null then
    raise exception 'ECHEC : anomalie initiale mal créée (origin %, résolue %)',
      v_a.origin, v_a.resolved_at;
  end if;
  update ctx set anomaly = v_a.id;
  raise notice 'TEST 0 OK — anomalie recalculée créée, ouverte, origin = synchronisation';
end $$;

-- ===========================================================================
-- TEST 1 — Migration 12 : bloquée, puis affectable une fois tranchée
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e000-000000000001';

do $$
declare v_ctx record; v_refuse boolean := false; v_res jsonb;
begin
  select * into v_ctx from ctx;
  reset role;
  insert into public.delivery_jobs (id, organization_id, reference, customer_name, origin_warehouse_id)
  values ('e3000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000001',
          'LIV-E-1', 'Client E', v_ctx.argenteuil);
  set role authenticated;

  begin
    perform public.allocate_to_delivery_job(v_ctx.line, 'e3000000-0000-4000-e000-000000000001', 1);
  exception when others then v_refuse := true;
  end;
  if not v_refuse then
    raise exception 'ECHEC : affectation acceptée malgré une anomalie bloquante ouverte';
  end if;

  v_res := public.resolve_logistics_anomaly(
    v_ctx.anomaly, 'traitee', 'Client rappelé : la commande est maintenue.');
  if v_res->>'resolution' <> 'traitee' or v_res->>'resolved_at' is null then
    raise exception 'ECHEC : résolution non enregistrée : %', v_res;
  end if;
  if jsonb_array_length(v_res->'decisions') <> 1
     or v_res->'decisions'->0->>'action' <> 'resolution'
     or v_res->'decisions'->0->>'decided_by_label' <> 'Resp. log. E' then
    raise exception 'ECHEC : historique de décision incomplet : %', v_res->'decisions';
  end if;

  perform public.allocate_to_delivery_job(v_ctx.line, 'e3000000-0000-4000-e000-000000000001', 1);
  raise notice 'TEST 1 OK — bloquée avant décision, affectable après, décision tracée';
end $$;

-- ===========================================================================
-- TEST 2 — La décision tient tant que la ligne source est inchangée
-- ===========================================================================
do $$
declare v_ctx record; v_open integer;
begin
  select * into v_ctx from ctx;
  -- Même contenu, même anomalie produite par le parseur : rien ne renaît.
  perform public.sync_recap_rows(v_ctx.source, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-E1', 'fingerprint', 'fp-e1',
      'recap_date', '2026-02-01', 'designation', 'CANAPE ANNULE', 'quantity', 1,
      'customer_label', 'Client E', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('J', 'ANNULER FRAUDE'),
      'events', '[]'::jsonb,
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'annulation_signalee', 'severity', 'bloquant',
        'message', 'Annulation signalée.')))
  ), 'manuel');
  reset role;
  select count(*) into v_open from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and resolved_at is null;
  set role authenticated;
  if v_open <> 0 then
    raise exception 'ECHEC : % anomalie(s) recréée(s) malgré une décision sur le même contenu', v_open;
  end if;

  -- Le contenu change (nouveau commentaire) : la décision ne couvre plus,
  -- l'anomalie renaît.
  perform public.sync_recap_rows(v_ctx.source, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-E1', 'fingerprint', 'fp-e1',
      'recap_date', '2026-02-01', 'designation', 'CANAPE ANNULE', 'quantity', 1,
      'customer_label', 'Client E', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('J', 'ANNULER FRAUDE — CLIENT INJOIGNABLE'),
      'events', '[]'::jsonb,
      'anomalies', jsonb_build_array(jsonb_build_object(
        'type', 'annulation_signalee', 'severity', 'bloquant',
        'message', 'Annulation signalée (bis).')))
  ), 'manuel');
  reset role;
  select count(*) into v_open from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and resolved_at is null
    and type = 'annulation_signalee' and message = 'Annulation signalée (bis).';
  set role authenticated;
  if v_open <> 1 then
    raise exception 'ECHEC : anomalie non recréée après changement de contenu (%)', v_open;
  end if;
  raise notice 'TEST 2 OK — décision respectée à contenu égal, anomalie recréée si le contenu change';
end $$;

-- ===========================================================================
-- TEST 3 — Cause disparue : fermeture automatique tracée
-- ===========================================================================
do $$
declare v_ctx record; v_rep jsonb; v_a record; v_d record;
begin
  select * into v_ctx from ctx;
  v_rep := public.sync_recap_rows(v_ctx.source, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-E1', 'fingerprint', 'fp-e1',
      'recap_date', '2026-02-01', 'designation', 'CANAPE ANNULE', 'quantity', 1,
      'customer_label', 'Client E', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('J', ''),
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');
  if (v_rep->>'anomalies_closed')::int <> 1 then
    raise exception 'ECHEC : % fermeture(s) automatique(s) au lieu de 1', v_rep->>'anomalies_closed';
  end if;
  reset role;
  select * into v_a from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and message = 'Annulation signalée (bis).';
  select * into v_d from public.logistics_anomaly_decisions
  where anomaly_id = v_a.id order by decided_at desc limit 1;
  set role authenticated;
  if v_a.resolved_at is null or v_a.resolution <> 'disparue' or v_a.resolved_by is not null then
    raise exception 'ECHEC : fermeture automatique mal enregistrée (%, %)', v_a.resolution, v_a.resolved_by;
  end if;
  if v_d.action <> 'fermeture_automatique' or v_d.recap_read_id is null or v_d.decided_by is not null then
    raise exception 'ECHEC : trace de fermeture automatique incomplète';
  end if;
  raise notice 'TEST 3 OK — cause disparue du fichier : fermée automatiquement, lecture tracée';
end $$;

-- ===========================================================================
-- TEST 4 — Une anomalie MANUELLE survit à la synchronisation
-- ===========================================================================
do $$
declare v_ctx record; v_m jsonb; v_open integer;
begin
  select * into v_ctx from ctx;
  v_m := public.report_logistics_anomaly(v_ctx.line, 'avertissement',
           'Carton abîmé constaté au dépôt.');
  if v_m->>'origin' <> 'manuelle' or v_m->>'type' <> 'signalement_manuel' then
    raise exception 'ECHEC : signalement manuel mal créé : %', v_m;
  end if;
  perform public.sync_recap_rows(v_ctx.source, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-E1', 'fingerprint', 'fp-e1',
      'recap_date', '2026-02-01', 'designation', 'CANAPE ANNULE', 'quantity', 1,
      'customer_label', 'Client E', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('J', ''),
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');
  reset role;
  select count(*) into v_open from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and resolved_at is null and origin = 'manuelle';
  set role authenticated;
  if v_open <> 1 then
    raise exception 'ECHEC : le signalement manuel a été fermé par la synchronisation';
  end if;
  raise notice 'TEST 4 OK — anomalie manuelle jamais fermée par la synchronisation';
end $$;

-- ===========================================================================
-- TEST 5 — Réouverture tracée ; l'historique est en ajout seul
-- ===========================================================================
do $$
declare v_ctx record; v_a jsonb; v_id uuid; v_refuse boolean := false;
begin
  select * into v_ctx from ctx;
  v_a := public.reopen_logistics_anomaly(v_ctx.anomaly, 'Le client s''est finalement rétracté.');
  if v_a->>'resolved_at' is not null or v_a->>'resolution' is not null then
    raise exception 'ECHEC : réouverture sans effet : %', v_a;
  end if;
  if jsonb_array_length(v_a->'decisions') <> 2
     or v_a->'decisions'->1->>'action' <> 'reouverture'
     or v_a->'decisions'->1->'previous_state'->>'resolution' <> 'traitee' then
    raise exception 'ECHEC : historique de réouverture incomplet : %', v_a->'decisions';
  end if;

  reset role;
  select id into v_id from public.logistics_anomaly_decisions
  where anomaly_id = v_ctx.anomaly limit 1;
  begin
    update public.logistics_anomaly_decisions set note = 'falsifié' where id = v_id;
  exception when others then v_refuse := true;
  end;
  set role authenticated;
  if not v_refuse then
    raise exception 'ECHEC : une décision a pu être modifiée';
  end if;
  raise notice 'TEST 5 OK — réouverture tracée, historique inaltérable';
end $$;

-- ===========================================================================
-- TEST 6 — Permissions et isolation
-- ===========================================================================
do $$
declare v_ctx record; v_refuse boolean;
begin
  select * into v_ctx from ctx;

  -- Note obligatoire.
  v_refuse := false;
  begin
    perform public.resolve_logistics_anomaly(v_ctx.anomaly, 'ignoree', ' ');
  exception when others then v_refuse := true;
  end;
  if not v_refuse then raise exception 'ECHEC : décision acceptée sans motif'; end if;

  -- Décision inconnue.
  v_refuse := false;
  begin
    perform public.resolve_logistics_anomaly(v_ctx.anomaly, 'disparue', 'Tentative.');
  exception when others then v_refuse := true;
  end;
  if not v_refuse then raise exception 'ECHEC : « disparue » accepté comme décision humaine'; end if;
  raise notice 'TEST 6a OK — motif obligatoire, « disparue » réservé à la synchronisation';
end $$;

set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e000-000000000002';
do $$
declare v_ctx record; v_refuse boolean := false; v_d jsonb;
begin
  select * into v_ctx from ctx;
  -- Le rôle « logistique » consulte…
  v_d := public.get_logistics_line(v_ctx.line);
  if jsonb_array_length(v_d->'anomalies') < 2 then
    raise exception 'ECHEC : lecture des anomalies impossible pour « logistique »';
  end if;
  -- … mais ne tranche pas.
  begin
    perform public.resolve_logistics_anomaly(v_ctx.anomaly, 'ignoree', 'Je passe outre.');
  exception when others then v_refuse := true;
  end;
  if not v_refuse then raise exception 'ECHEC : « logistique » a pu trancher'; end if;
  raise notice 'TEST 6b OK — « logistique » consulte mais ne tranche pas';
end $$;

set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e000-000000000003';
do $$
declare v_ctx record; v_refuse boolean := false;
begin
  select * into v_ctx from ctx;
  begin
    perform public.resolve_logistics_anomaly(v_ctx.anomaly, 'ignoree', 'Depuis l''organisation B.');
  exception when others then v_refuse := true;
  end;
  if not v_refuse then raise exception 'ECHEC : organisation B a tranché une anomalie de A'; end if;
  v_refuse := false;
  begin
    perform public.get_logistics_anomaly(v_ctx.anomaly);
  exception when others then v_refuse := true;
  end;
  if not v_refuse then raise exception 'ECHEC : organisation B a lu une anomalie de A'; end if;
  raise notice 'TEST 6c OK — cloisonnement total entre organisations';
end $$;

-- ===========================================================================
-- TEST 7 — Ligne absente puis revenue : son anomalie se ferme
-- ===========================================================================
set local "request.jwt.claim.sub" = 'e1000000-0000-4000-e000-000000000001';
do $$
declare v_ctx record; v_rep jsonb; v_open integer; v_closed integer;
begin
  select * into v_ctx from ctx;
  -- Lecture sans la ligne : elle est marquée absente.
  v_rep := public.sync_recap_rows(v_ctx.source, '[]'::jsonb, 'manuel');
  if (v_rep->>'missing')::int <> 1 then
    raise exception 'ECHEC : ligne non marquée absente';
  end if;
  reset role;
  select count(*) into v_open from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and type = 'ligne_absente_du_fichier' and resolved_at is null;
  set role authenticated;
  if v_open <> 1 then raise exception 'ECHEC : anomalie « absente » manquante'; end if;

  -- La ligne revient.
  v_rep := public.sync_recap_rows(v_ctx.source, jsonb_build_array(
    jsonb_build_object(
      'ignored', false, 'recap_row_id', 'TR-E1', 'fingerprint', 'fp-e1',
      'recap_date', '2026-02-01', 'designation', 'CANAPE ANNULE', 'quantity', 1,
      'customer_label', 'Client E', 'stage', 'disponible',
      'current_warehouse_id', v_ctx.argenteuil,
      'destination_warehouse_id', v_ctx.argenteuil, 'destination_confidence', 'sure',
      'raw_row', jsonb_build_object('J', ''),
      'events', '[]'::jsonb, 'anomalies', '[]'::jsonb)
  ), 'manuel');
  reset role;
  select count(*) into v_open from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and type = 'ligne_absente_du_fichier' and resolved_at is null;
  select count(*) into v_closed from public.logistics_anomalies
  where logistics_line_id = v_ctx.line and type = 'ligne_absente_du_fichier' and resolution = 'disparue';
  set role authenticated;
  if v_open <> 0 or v_closed <> 1 then
    raise exception 'ECHEC : anomalie « absente » non fermée au retour (% ouverte, % fermée)', v_open, v_closed;
  end if;
  raise notice 'TEST 7 OK — ligne revenue : anomalie « absente » fermée automatiquement';
end $$;

-- ===========================================================================
-- TEST 8 — Aucune lecture directe de l'historique
-- ===========================================================================
do $$
declare v_n integer; v_refuse boolean := false;
begin
  begin
    select count(*) into v_n from public.logistics_anomaly_decisions;
  exception when insufficient_privilege then v_refuse := true;
  end;
  if not v_refuse and v_n <> 0 then
    raise exception 'ECHEC : % décision(s) lisible(s) en direct', v_n;
  end if;
  raise notice 'TEST 8 OK — historique des décisions inaccessible en direct';
end $$;

reset role;
rollback;

\echo 'TOUS LES TESTS PHASE 5 SONT PASSES (transaction annulée, base intacte).'
