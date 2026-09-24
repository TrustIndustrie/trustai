-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 15 (import des exports Skara)
--
-- Prouve, sur une base réelle :
--   1. un export de factures s'écrit, avec ses anomalies tracées ;
--   2. le MÊME fichier réimporté ne réécrit rien et le dit ;
--   3. un fichier qui CHEVAUCHE le précédent met à jour sans dupliquer ;
--   4. une anomalie bloquante refuse l'écriture ;
--   5. un fichier étiqueté du mauvais magasin est refusé ; sans préfixe
--      configuré, l'import passe mais trace une information ;
--   6. la pièce sans numéro est écrite grâce à sa clé de repli ;
--   7. journal comptable et catalogue s'écrivent avec leurs clés propres ;
--   8. permissions : « logistique » n'importe pas et ne lit pas ;
--   9. isolation : une autre organisation ne voit rien ;
--  10. aucune lecture directe des six tables.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000003', 'Organisation D (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-a100-000000000001', 'admin.skara@test.local'),
  ('a1000000-0000-4000-a100-000000000002', 'logistique.skara@test.local'),
  ('a1000000-0000-4000-a100-000000000003', 'respmag.skara@test.local'),
  ('a1000000-0000-4000-a100-000000000004', 'admin.autre@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('a1000000-0000-4000-a100-000000000001', '00000000-0000-4000-a000-000000000001',
   'Admin Skara', 'administrateur'),
  ('a1000000-0000-4000-a100-000000000002', '00000000-0000-4000-a000-000000000001',
   'Logistique Skara', 'logistique'),
  ('a1000000-0000-4000-a100-000000000003', '00000000-0000-4000-a000-000000000001',
   'Resp. magasin Skara', 'responsable_magasin'),
  ('a1000000-0000-4000-a100-000000000004', 'b0000000-0000-4000-b000-000000000003',
   'Admin autre org', 'administrateur');

-- Le magasin de Lisses reçoit son préfixe de numérotation Skara.
update public.stores set skara_invoice_prefix = 'FL'
where id = '00000000-0000-4000-a000-000000000201';

create temporary table ctx as
select null::uuid as import1, null::uuid as import2, null::uuid as journal;
grant all on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Premier import : deux factures, un avoir, une pièce non émise
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000001';

do $$
declare v_report jsonb;
begin
  v_report := public.import_skara_file(jsonb_build_object(
    'kind', 'liste_factures',
    'store_id', '00000000-0000-4000-a000-000000000201',
    'file_name', 'export_liste_facture_1.csv',
    'content_hash', 'hash-lot-1',
    'period', jsonb_build_object('start', '2026-09-02', 'end', '2026-09-19'),
    'prefixes', jsonb_build_array('FL'),
    'footer', jsonb_build_object('totalTtc', '2969'),
    'computed', jsonb_build_object('totalTtc', 2969),
    'anomalies', jsonb_build_array(jsonb_build_object(
      'kind', 'montant_negatif_sans_avoir', 'severity', 'avertissement',
      'message', 'Montant négatif sur une facture.')),
    'rows', jsonb_build_array(
      jsonb_build_object(
        'doc_type', 'facture', 'number', 'FL20260900218', 'row_key', 'FL20260900218',
        'accounting_state', 'non_exportee', 'date', '2026-09-02',
        'client_label', 'Client B', 'total_ttc', '449.00', 'total_ht', '374.166',
        'vat', '74.834', 'margin_skara', '171.166', 'remaining_due', '0',
        'eco_ttc', '0.00', 'service_ttc', '-50.00', 'raw', jsonb_build_array('x')),
      jsonb_build_object(
        'doc_type', 'avoir', 'number', 'FL20260900211', 'row_key', 'FL20260900211',
        'accounting_state', 'non_exportee', 'date', '2026-09-02',
        'client_label', 'Client A', 'total_ttc', '-1378', 'total_ht', '-1148.333',
        'vat', '-229.667', 'margin_skara', '-715.443', 'eco_ttc', '-2.64',
        'service_ttc', '170', 'raw', jsonb_build_array('x')),
      jsonb_build_object(
        'doc_type', 'non_emise', 'row_key', 'sans-numero:18-09-2026|client d|-150',
        'date', '2026-09-18', 'client_label', 'Client D', 'total_ttc', '-150',
        'total_ht', '-125', 'vat', '-25', 'raw', jsonb_build_array('x')))));

  if (v_report->>'created')::int <> 3 then
    raise exception 'ÉCHEC 1 : % ligne(s) créée(s) au lieu de 3', v_report->>'created';
  end if;
  if (v_report->>'already_imported')::boolean then
    raise exception 'ÉCHEC 1 : fichier considéré comme déjà importé';
  end if;
end $$;
reset role;

update ctx set import1 = (select id from public.skara_imports where content_hash = 'hash-lot-1');

do $$
declare v_count integer; v_anom integer; v_ht numeric;
begin
  select count(*) into v_count from public.skara_invoices;
  if v_count <> 3 then raise exception 'ÉCHEC 1 : % facture(s) en base', v_count; end if;

  -- Le montant est conservé tel quel, à trois décimales.
  select total_ht into v_ht from public.skara_invoices where number = 'FL20260900218';
  if v_ht <> 374.166 then raise exception 'ÉCHEC 1 : hors taxes altéré (%)', v_ht; end if;

  -- La pièce sans numéro existe, identifiée par sa clé de repli.
  select count(*) into v_count from public.skara_invoices
  where doc_type = 'non_emise' and number is null;
  if v_count <> 1 then raise exception 'ÉCHEC 6 : pièce non émise absente'; end if;

  -- L'anomalie du fichier ET celle du préfixe manquant sont tracées.
  select count(*) into v_anom from public.skara_import_anomalies;
  if v_anom <> 1 then raise exception 'ÉCHEC 1 : % anomalie(s) tracée(s) au lieu de 1', v_anom; end if;
  raise notice 'OK 1 et 6 : import écrit, montants intacts, pièce non émise gardée.';
end $$;

-- ---------------------------------------------------------------------------
-- 2 et 3. Réimport à l'identique, puis fichier qui chevauche
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000001';

do $$
declare v_report jsonb;
begin
  -- Même empreinte : rien ne doit être écrit.
  v_report := public.import_skara_file(jsonb_build_object(
    'kind', 'liste_factures',
    'store_id', '00000000-0000-4000-a000-000000000201',
    'file_name', 'export_liste_facture_1.csv',
    'content_hash', 'hash-lot-1',
    'prefixes', jsonb_build_array('FL'),
    'rows', jsonb_build_array()));
  if not (v_report->>'already_imported')::boolean then
    raise exception 'ÉCHEC 2 : le même fichier a été réimporté';
  end if;

  -- Empreinte différente, une facture connue avec un montant corrigé et une
  -- nouvelle : mise à jour sans doublon.
  v_report := public.import_skara_file(jsonb_build_object(
    'kind', 'liste_factures',
    'store_id', '00000000-0000-4000-a000-000000000201',
    'file_name', 'export_liste_facture_2.csv',
    'content_hash', 'hash-lot-2',
    'prefixes', jsonb_build_array('FL'),
    'rows', jsonb_build_array(
      jsonb_build_object(
        'doc_type', 'facture', 'number', 'FL20260900218', 'row_key', 'FL20260900218',
        'accounting_state', 'exportee', 'date', '2026-09-02',
        'client_label', 'Client B', 'total_ttc', '459.00', 'total_ht', '382.500',
        'vat', '76.500', 'raw', jsonb_build_array('y')),
      jsonb_build_object(
        'doc_type', 'facture', 'number', 'FL20260900219', 'row_key', 'FL20260900219',
        'accounting_state', 'non_exportee', 'date', '2026-09-05',
        'client_label', 'Client G', 'total_ttc', '380.00', 'total_ht', '316.667',
        'vat', '63.333', 'raw', jsonb_build_array('y')))));
  if (v_report->>'created')::int <> 1 or (v_report->>'updated')::int <> 1 then
    raise exception 'ÉCHEC 3 : rapport inattendu %', v_report::text;
  end if;
end $$;
reset role;

do $$
declare v_count integer; v_ttc numeric; v_state text;
begin
  select count(*) into v_count from public.skara_invoices;
  if v_count <> 4 then raise exception 'ÉCHEC 3 : % facture(s) au lieu de 4', v_count; end if;
  select total_ttc, accounting_state into v_ttc, v_state
  from public.skara_invoices where number = 'FL20260900218';
  if v_ttc <> 459.00 or v_state <> 'exportee' then
    raise exception 'ÉCHEC 3 : facture non rafraîchie (% / %)', v_ttc, v_state;
  end if;
  raise notice 'OK 2 et 3 : réimport neutre, chevauchement mis à jour sans doublon.';
end $$;

-- ---------------------------------------------------------------------------
-- 4 et 5. Anomalie bloquante, et contrôle du magasin
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000001';

do $$
begin
  begin
    perform public.import_skara_file(jsonb_build_object(
      'kind', 'liste_factures',
      'store_id', '00000000-0000-4000-a000-000000000201',
      'file_name', 'incoherent.csv', 'content_hash', 'hash-bloquant',
      'prefixes', jsonb_build_array('FL'),
      'anomalies', jsonb_build_array(jsonb_build_object(
        'kind', 'total_incoherent', 'severity', 'bloquant',
        'message', 'Le total du pied ne correspond pas.')),
      'rows', jsonb_build_array()));
    raise exception 'ÉCHEC 4 : fichier bloquant accepté';
  exception when others then
    if position('bloquante' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.import_skara_file(jsonb_build_object(
      'kind', 'liste_factures',
      'store_id', '00000000-0000-4000-a000-000000000201',
      'file_name', 'mauvais_magasin.csv', 'content_hash', 'hash-prefixe',
      'prefixes', jsonb_build_array('FM'),
      'rows', jsonb_build_array()));
    raise exception 'ÉCHEC 5 : fichier du mauvais magasin accepté';
  exception when others then
    if position('préfixe' in sqlerrm) = 0 then raise; end if;
  end;

  -- Magasin sans préfixe configuré : l'import passe, avec une information.
  perform public.import_skara_file(jsonb_build_object(
    'kind', 'liste_factures',
    'store_id', '00000000-0000-4000-a000-000000000202',
    'file_name', 'herblay.csv', 'content_hash', 'hash-herblay',
    'prefixes', jsonb_build_array('FC'),
    'rows', jsonb_build_array(jsonb_build_object(
      'doc_type', 'facture', 'number', 'FC20260900605', 'row_key', 'FC20260900605',
      'date', '2026-09-01', 'total_ttc', '1028.00', 'total_ht', '856.667',
      'vat', '171.333', 'raw', jsonb_build_array('z')))));

  -- Le magasin est obligatoire pour un export de factures.
  begin
    perform public.import_skara_file(jsonb_build_object(
      'kind', 'liste_factures', 'file_name', 'sans_magasin.csv',
      'content_hash', 'hash-sans-magasin', 'rows', jsonb_build_array()));
    raise exception 'ÉCHEC 5 : import de factures sans magasin accepté';
  exception when others then
    if position('magasin est obligatoire' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
reset role;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.skara_import_anomalies
  where kind = 'prefixe_magasin_non_configure';
  if v_count <> 1 then
    raise exception 'ÉCHEC 5 : préfixe manquant non signalé (%)', v_count;
  end if;
  select count(*) into v_count from public.skara_imports
  where content_hash in ('hash-bloquant', 'hash-prefixe', 'hash-sans-magasin');
  if v_count <> 0 then
    raise exception 'ÉCHEC 4 : % import(s) refusé(s) pourtant enregistré(s)', v_count;
  end if;
  raise notice 'OK 4 et 5 : fichier incohérent et mauvais magasin refusés.';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Journal comptable et catalogue
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000001';

do $$
declare v_report jsonb;
begin
  v_report := public.import_skara_file(jsonb_build_object(
    'kind', 'journal_comptable',
    'file_name', 'ecriture.xls', 'content_hash', 'hash-journal',
    'period', jsonb_build_object('start', '2026-09-19', 'end', '2026-09-19'),
    'computed', jsonb_build_object('debit', 1698, 'credit', 1698),
    'rows', jsonb_build_array(
      jsonb_build_object('row_index', 0, 'journal_code', 'VT', 'date', '2026-09-19',
        'auxiliary_account', '4115009611', 'general_account', '411500',
        'piece', 'FL20260900234', 'label', 'Client E', 'debit', '1698.00',
        'currency', 'EUR', 'raw', jsonb_build_array('j')),
      jsonb_build_object('row_index', 1, 'journal_code', 'VT', 'date', '2026-09-19',
        'general_account', '445717', 'piece', 'FL20260900234',
        'label', 'TVA collectée', 'credit', '283.00', 'currency', 'EUR',
        'raw', jsonb_build_array('j')),
      jsonb_build_object('row_index', 2, 'journal_code', 'VT', 'date', '2026-09-19',
        'general_account', '707005', 'piece', 'FL20260900234',
        'label', 'Vente marchandises', 'credit', '1415.00', 'currency', 'EUR',
        'raw', jsonb_build_array('j')))));
  if (v_report->>'created')::int <> 3 then
    raise exception 'ÉCHEC 7 : % écriture(s) au lieu de 3', v_report->>'created';
  end if;

  v_report := public.import_skara_file(jsonb_build_object(
    'kind', 'catalogue',
    'file_name', 'export_produit.csv', 'content_hash', 'hash-catalogue',
    'rows', jsonb_build_array(
      jsonb_build_object('reference', '48700', 'supplier_label', 'SKU 34 - DREAMS FLY',
        'title', 'COUSSIN COOLING', 'family_label', 'Lits',
        'purchase_gross', '31.38', 'coefficient', '3.1549',
        'sale_price_ttc', '99.00', 'purchase_net_computed', '31.38',
        'net_origin', 'reconstruit', 'raw', jsonb_build_array('a')),
      jsonb_build_object('reference', '48702', 'title', 'MATELAS SANS PRIX',
        'net_origin', 'absent', 'sale_price_ttc', '349.00',
        'raw', jsonb_build_array('a')))));
  if (v_report->>'created')::int <> 2 then
    raise exception 'ÉCHEC 7 : % article(s) au lieu de 2', v_report->>'created';
  end if;
end $$;
reset role;

do $$
declare v_debit numeric; v_credit numeric; v_origin text;
begin
  select sum(debit), sum(credit) into v_debit, v_credit
  from public.skara_journal_entries;
  if v_debit <> v_credit then
    raise exception 'ÉCHEC 7 : journal déséquilibré en base (% / %)', v_debit, v_credit;
  end if;
  select net_origin into v_origin from public.skara_articles where reference = '48700';
  if v_origin <> 'reconstruit' then
    raise exception 'ÉCHEC 7 : origine du coût perdue (%)', v_origin;
  end if;
  raise notice 'OK 7 : journal équilibré et catalogue écrits.';
end $$;

-- ---------------------------------------------------------------------------
-- 8 et 9. Permissions et isolation
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000002';
do $$
begin
  begin
    perform public.import_skara_file(jsonb_build_object(
      'kind', 'catalogue', 'file_name', 'x.csv', 'content_hash', 'hash-refus',
      'rows', jsonb_build_array()));
    raise exception 'ÉCHEC 8 : le rôle logistique a importé';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.list_skara_imports();
    raise exception 'ÉCHEC 8 : le rôle logistique a lu les imports';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end $$;
reset role;

-- Le responsable de magasin, lui, consulte.
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000003';
do $$
declare v_list jsonb;
begin
  -- Cinq imports ont abouti : deux listes de factures de Lisses, une de
  -- Herblay, un journal, un catalogue. Les quatre fichiers refusés n'ont
  -- laissé aucune trace.
  v_list := public.list_skara_imports();
  if jsonb_array_length(v_list) <> 5 then
    raise exception 'ÉCHEC 8 : % import(s) visible(s) au lieu de 5', jsonb_array_length(v_list);
  end if;
end $$;
reset role;

set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000004';
do $$
declare v_ctx record; v_list jsonb;
begin
  select * into v_ctx from ctx;
  v_list := public.list_skara_imports();
  if jsonb_array_length(v_list) <> 0 then
    raise exception 'ÉCHEC 9 : une autre organisation voit % import(s)',
      jsonb_array_length(v_list);
  end if;
  begin
    perform public.get_skara_import(v_ctx.import1);
    raise exception 'ÉCHEC 9 : lecture interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  -- Un magasin d'une autre organisation est refusé.
  begin
    perform public.import_skara_file(jsonb_build_object(
      'kind', 'liste_factures',
      'store_id', '00000000-0000-4000-a000-000000000201',
      'file_name', 'vol.csv', 'content_hash', 'hash-vol',
      'rows', jsonb_build_array()));
    raise exception 'ÉCHEC 9 : import sur le magasin d''une autre organisation accepté';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 8 et 9 : permissions et isolation tenues.';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 10. Aucune lecture directe des six tables
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a100-000000000001';
do $$
declare t text; v integer;
begin
  foreach t in array array['skara_imports', 'skara_invoices',
                           'skara_invoice_lines', 'skara_articles',
                           'skara_journal_entries', 'skara_import_anomalies']
  loop
    begin
      execute format('select count(*) from public.%I', t) into v;
      raise exception 'ÉCHEC 10 : lecture directe de % autorisée', t;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  raise notice 'OK 10 : les six tables ne sont pas lisibles directement.';
end $$;
reset role;

rollback;
