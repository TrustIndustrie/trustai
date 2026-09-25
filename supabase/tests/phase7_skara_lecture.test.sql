-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 16 (lecture des données Skara)
--
-- Prouve, sur une base réelle :
--   1. la liste des factures agrège et filtre correctement, avoirs compris ;
--   2. la marge creuse est détectée : marge égale au hors taxes ;
--   3. le détail d'une pièce porte ses lignes et sa contrepartie, car une
--      facture entièrement annulée n'existe que sous forme d'avoir ;
--   4. le contrôle mensuel recoupe liste des factures et journal comptable,
--      et l'écart s'explique par les pièces non émises ;
--   5. les articles sans coût sont listés par impact décroissant ;
--   6. permissions : « logistique » ne lit rien ;
--   7. isolation : une autre organisation ne voit rien ;
--   8. cloisonnement (migration 17) : un responsable de magasin ne lit que
--      les magasins qui lui sont accordés, et le journal comptable, qui ne
--      porte pas le magasin, lui est masqué.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000004', 'Organisation E (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('d1000000-0000-4000-d100-000000000001', 'admin.lecture@test.local'),
  ('d1000000-0000-4000-d100-000000000002', 'respmag.lecture@test.local'),
  ('d1000000-0000-4000-d100-000000000003', 'logistique.lecture@test.local'),
  ('d1000000-0000-4000-d100-000000000004', 'admin.autre.lecture@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('d1000000-0000-4000-d100-000000000001', '00000000-0000-4000-a000-000000000001',
   'Admin lecture', 'administrateur'),
  ('d1000000-0000-4000-d100-000000000002', '00000000-0000-4000-a000-000000000001',
   'Resp. magasin lecture', 'responsable_magasin'),
  ('d1000000-0000-4000-d100-000000000003', '00000000-0000-4000-a000-000000000001',
   'Logistique lecture', 'logistique'),
  ('d1000000-0000-4000-d100-000000000004', 'b0000000-0000-4000-b000-000000000004',
   'Admin autre', 'administrateur');

update public.stores set skara_invoice_prefix = 'FL'
where id = '00000000-0000-4000-a000-000000000201';
update public.stores set skara_invoice_prefix = 'FH'
where id = '00000000-0000-4000-a000-000000000202';

-- Le responsable de magasin n'a accès QU'À Lisses. Sans cette ligne, il ne
-- voit rien : depuis la migration 17, un profil sans magasin accordé n'est
-- plus un profil qui voit tout.
insert into public.user_store_access (profile_id, store_id) values
  ('d1000000-0000-4000-d100-000000000002', '00000000-0000-4000-a000-000000000201');

create temporary table ctx as
select null::uuid as facture, null::uuid as avoir;
grant all on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- Jeu de données : trois pièces reprenant la structure réelle, plus les
-- lignes de la facture et un journal équilibré du même mois.
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000001';

do $$
begin
  perform public.import_skara_file(jsonb_build_object(
    'kind', 'liste_factures',
    'store_id', '00000000-0000-4000-a000-000000000201',
    'file_name', 'factures.csv', 'content_hash', 'lecture-factures',
    'period', jsonb_build_object('start', '2026-09-02', 'end', '2026-09-19'),
    'prefixes', jsonb_build_array('FL'),
    'rows', jsonb_build_array(
      -- Facture normale, marge exploitable.
      jsonb_build_object('doc_type', 'facture', 'number', 'FL20260900218',
        'row_key', 'FL20260900218', 'accounting_state', 'non_exportee',
        'date', '2026-09-02', 'client_label', 'Client B',
        'seller_label', 'Vendeur 1', 'total_ttc', '449.00',
        'total_ht', '374.166', 'vat', '74.834', 'margin_skara', '171.166',
        'remaining_due', '0'),
      -- Marge CREUSE : elle égale le hors taxes, donc coût absent. Et sans
      -- vendeur, comme 97 % des factures réelles.
      jsonb_build_object('doc_type', 'facture', 'number', 'FL20260900220',
        'row_key', 'FL20260900220', 'accounting_state', 'non_exportee',
        'date', '2026-09-06', 'client_label', 'Client C',
        'total_ttc', '2350.00', 'total_ht', '1958.333', 'vat', '391.667',
        'margin_skara', '1958.333', 'remaining_due', '0'),
      -- Avoir portant le numéro d'une facture entièrement annulée.
      jsonb_build_object('doc_type', 'avoir', 'number', 'FL20260900211',
        'row_key', 'FL20260900211', 'accounting_state', 'non_exportee',
        'date', '2026-09-02', 'client_label', 'Client A',
        'total_ttc', '-1378', 'total_ht', '-1148.333', 'vat', '-229.667',
        'margin_skara', '-715.443'),
      -- Pièce non émise : absente de la comptabilité, d'où l'écart attendu.
      jsonb_build_object('doc_type', 'non_emise',
        'row_key', 'sans-numero:18-09-2026|client d|-150',
        'date', '2026-09-18', 'client_label', 'Client D',
        'total_ttc', '-150', 'total_ht', '-125', 'vat', '-25'))));

  perform public.import_skara_file(jsonb_build_object(
    'kind', 'lignes_factures',
    'store_id', '00000000-0000-4000-a000-000000000201',
    'file_name', 'lignes.csv', 'content_hash', 'lecture-lignes',
    'prefixes', jsonb_build_array('FL'),
    'rows', jsonb_build_array(
      jsonb_build_object('invoice_number', 'FL20260900218', 'line_index', 1,
        'date', '2026-09-02', 'label', 'Canapé CASABLANCA', 'quantity', 1,
        'total_price_ttc', '499.00', 'nature_proposed', 'produit'),
      jsonb_build_object('invoice_number', 'FL20260900218', 'line_index', 2,
        'date', '2026-09-02', 'label', 'Remise 1', 'quantity', 1,
        'total_price_ttc', '-50.00', 'nature_proposed', 'remise'))));

  -- Journal du même mois : 218 et 220 seulement, l'avoir et la pièce non
  -- émise n'y figurant pas. L'écart doit donc s'expliquer.
  perform public.import_skara_file(jsonb_build_object(
    'kind', 'journal_comptable',
    'file_name', 'ecriture.xls', 'content_hash', 'lecture-journal',
    'rows', jsonb_build_array(
      jsonb_build_object('row_index', 0, 'journal_code', 'VT', 'date', '2026-09-02',
        'general_account', '411500', 'piece', 'FL20260900218', 'debit', '449.00'),
      jsonb_build_object('row_index', 1, 'journal_code', 'VT', 'date', '2026-09-02',
        'general_account', '445717', 'piece', 'FL20260900218', 'credit', '74.834'),
      jsonb_build_object('row_index', 2, 'journal_code', 'VT', 'date', '2026-09-02',
        'general_account', '707001', 'piece', 'FL20260900218', 'credit', '374.166'),
      jsonb_build_object('row_index', 3, 'journal_code', 'VT', 'date', '2026-09-06',
        'general_account', '411500', 'piece', 'FL20260900220', 'debit', '2350.00'),
      jsonb_build_object('row_index', 4, 'journal_code', 'VT', 'date', '2026-09-06',
        'general_account', '445717', 'piece', 'FL20260900220', 'credit', '391.667'),
      jsonb_build_object('row_index', 5, 'journal_code', 'VT', 'date', '2026-09-06',
        'general_account', '707001', 'piece', 'FL20260900220', 'credit', '1958.333'))));

  perform public.import_skara_file(jsonb_build_object(
    'kind', 'catalogue',
    'file_name', 'articles.csv', 'content_hash', 'lecture-catalogue',
    'rows', jsonb_build_array(
      jsonb_build_object('reference', '48700', 'title', 'COUSSIN COOLING',
        'supplier_label', 'SKU 34', 'family_label', 'Lits',
        'purchase_gross', '31.38', 'sale_price_ttc', '99.00',
        'purchase_net_computed', '31.38', 'net_origin', 'reconstruit'),
      jsonb_build_object('reference', '48702', 'title', 'MATELAS SANS PRIX',
        'supplier_label', 'SKU 20', 'family_label', 'Matelas',
        'sale_price_ttc', '349.00', 'net_origin', 'absent'),
      jsonb_build_object('reference', '48703', 'title', 'LIT SANS PRIX',
        'supplier_label', 'SKU 17', 'family_label', 'Lits',
        'sale_price_ttc', '1299.00', 'net_origin', 'absent'))));
end $$;
reset role;

update ctx set
  facture = (select id from public.skara_invoices where number = 'FL20260900218'),
  avoir = (select id from public.skara_invoices where doc_type = 'avoir');

-- ---------------------------------------------------------------------------
-- 1 et 2. Liste, agrégats, filtres et marge creuse
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000002';

do $$
declare v_list jsonb; v_row jsonb;
begin
  v_list := public.list_skara_invoices('{}'::jsonb);
  if (v_list->'totals'->>'pieces')::int <> 4 then
    raise exception 'ÉCHEC 1 : % pièce(s) au lieu de 4', v_list->'totals'->>'pieces';
  end if;
  if (v_list->'totals'->>'avoirs')::int <> 1
     or (v_list->'totals'->>'non_emises')::int <> 1 then
    raise exception 'ÉCHEC 1 : natures mal comptées %', v_list->'totals';
  end if;
  -- 449 + 2350 - 1378 - 150 = 1271
  if (v_list->'totals'->>'ttc')::numeric <> 1271 then
    raise exception 'ÉCHEC 1 : total toutes taxes % au lieu de 1271',
      v_list->'totals'->>'ttc';
  end if;

  -- Filtre par nature.
  v_list := public.list_skara_invoices(jsonb_build_object('doc_type', 'avoir'));
  if (v_list->'totals'->>'pieces')::int <> 1 then
    raise exception 'ÉCHEC 1 : filtre par nature inopérant';
  end if;

  -- Filtre par période : le 6 septembre seulement.
  v_list := public.list_skara_invoices(jsonb_build_object(
    'from', '2026-09-05', 'to', '2026-09-10'));
  if (v_list->'totals'->>'pieces')::int <> 1 then
    raise exception 'ÉCHEC 1 : filtre par période inopérant';
  end if;

  -- Recherche par numéro.
  v_list := public.list_skara_invoices(jsonb_build_object('search', '0900218'));
  if (v_list->'totals'->>'pieces')::int <> 1 then
    raise exception 'ÉCHEC 1 : recherche inopérante';
  end if;

  -- Marge creuse détectée sur la bonne pièce, et seulement elle.
  v_list := public.list_skara_invoices('{}'::jsonb);
  select value into v_row from jsonb_array_elements(v_list->'rows') as value
  where value->>'number' = 'FL20260900220';
  if not (v_row->>'margin_hollow')::boolean then
    raise exception 'ÉCHEC 2 : marge creuse non détectée';
  end if;
  select value into v_row from jsonb_array_elements(v_list->'rows') as value
  where value->>'number' = 'FL20260900218';
  if (v_row->>'margin_hollow')::boolean then
    raise exception 'ÉCHEC 2 : marge saine signalée comme creuse';
  end if;
  if (v_row->>'line_count')::int <> 2 then
    raise exception 'ÉCHEC 1 : % ligne(s) rattachée(s) au lieu de 2', v_row->>'line_count';
  end if;
  raise notice 'OK 1 et 2 : agrégats, filtres et marge creuse.';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Détail d'une pièce : lignes et contrepartie
-- ---------------------------------------------------------------------------
do $$
declare v_ctx record; v_doc jsonb;
begin
  select * into v_ctx from ctx;
  v_doc := public.get_skara_invoice(v_ctx.facture);
  if jsonb_array_length(v_doc->'lines') <> 2 then
    raise exception 'ÉCHEC 3 : % ligne(s) au lieu de 2', jsonb_array_length(v_doc->'lines');
  end if;
  if (v_doc->'lines'->0->>'nature') <> 'produit'
     or (v_doc->'lines'->1->>'nature') <> 'remise' then
    raise exception 'ÉCHEC 3 : natures de ligne perdues';
  end if;
  if (v_doc->'lines'->0->>'nature_confirmed')::boolean then
    raise exception 'ÉCHEC 3 : nature présentée comme confirmée alors qu''elle est proposée';
  end if;
  if v_doc->>'store_name' is null then
    raise exception 'ÉCHEC 3 : magasin absent du détail';
  end if;
  -- Aucune contrepartie pour cette facture, puisque aucun avoir ne porte son
  -- numéro.
  if v_doc->'counterpart' <> 'null'::jsonb and v_doc->'counterpart' is not null then
    raise exception 'ÉCHEC 3 : contrepartie inventée (%)', v_doc->'counterpart';
  end if;
  raise notice 'OK 3 : détail complet, lignes et natures.';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Contrôle mensuel et recoupement avec le journal
-- ---------------------------------------------------------------------------
do $$
declare v_ctrl jsonb; v_store jsonb; v_journal jsonb; v_ecart numeric;
begin
  v_ctrl := public.get_skara_monthly_control(null, null);

  select value into v_store from jsonb_array_elements(v_ctrl->'stores') as value
  where value->>'mois' = '2026-09';
  if v_store is null then raise exception 'ÉCHEC 4 : mois absent du contrôle'; end if;
  if (v_store->>'factures')::int <> 2 or (v_store->>'avoirs')::int <> 1
     or (v_store->>'non_emises')::int <> 1 then
    raise exception 'ÉCHEC 4 : natures mal réparties %', v_store;
  end if;
  if (v_store->>'sans_vendeur')::int <> 3 then
    raise exception 'ÉCHEC 4 : % pièce(s) sans vendeur au lieu de 3', v_store->>'sans_vendeur';
  end if;
  if (v_store->>'marge_creuse')::int <> 1
     or (v_store->>'marge_creuse_ht')::numeric <> 1958.333 then
    raise exception 'ÉCHEC 4 : marge creuse mal chiffrée %', v_store;
  end if;

  select value into v_journal from jsonb_array_elements(v_ctrl->'journal') as value
  where value->>'mois' = '2026-09';
  if v_journal is null then raise exception 'ÉCHEC 4 : journal absent'; end if;
  if (v_journal->>'debit')::numeric <> (v_journal->>'credit')::numeric then
    raise exception 'ÉCHEC 4 : journal déséquilibré dans le contrôle';
  end if;
  -- Ventes du journal : 374,166 + 1958,333 = 2332,499
  if (v_journal->>'ventes')::numeric <> 2332.499 then
    raise exception 'ÉCHEC 4 : ventes du journal % au lieu de 2332,499', v_journal->>'ventes';
  end if;

  -- L'ÉCART entre les deux sources doit s'expliquer exactement par l'avoir
  -- et la pièce non émise, absents de la comptabilité.
  -- Liste : 374,166 + 1958,333 - 1148,333 - 125 = 1059,166
  v_ecart := (v_journal->>'ventes')::numeric - (v_store->>'ht')::numeric;
  if abs(v_ecart - 1273.333) > 0.01 then
    raise exception 'ÉCHEC 4 : écart inexpliqué de % (attendu 1273,333)', v_ecart;
  end if;
  raise notice 'OK 4 : contrôle mensuel et recoupement du journal.';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Articles sans coût, par impact décroissant
-- ---------------------------------------------------------------------------
do $$
declare v_articles jsonb;
begin
  v_articles := public.list_skara_articles_without_cost(50);
  if (v_articles->'totals'->>'articles')::int <> 3
     or (v_articles->'totals'->>'sans_cout')::int <> 2
     or (v_articles->'totals'->>'reconstruits')::int <> 1 then
    raise exception 'ÉCHEC 5 : totaux du catalogue inattendus %', v_articles->'totals';
  end if;
  if jsonb_array_length(v_articles->'rows') <> 2 then
    raise exception 'ÉCHEC 5 : % article(s) listé(s) au lieu de 2',
      jsonb_array_length(v_articles->'rows');
  end if;
  -- Le plus cher d'abord : c'est l'ordre d'impact.
  if (v_articles->'rows'->0->>'reference') <> '48703' then
    raise exception 'ÉCHEC 5 : classement par impact non respecté';
  end if;
  raise notice 'OK 5 : articles sans coût listés par impact.';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6 et 7. Permissions et isolation
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000003';
do $$
declare v_ctx record;
begin
  select * into v_ctx from ctx;
  begin
    perform public.list_skara_invoices('{}'::jsonb);
    raise exception 'ÉCHEC 6 : le rôle logistique a lu les factures';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.get_skara_monthly_control(null, null);
    raise exception 'ÉCHEC 6 : le rôle logistique a lu le contrôle';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.list_skara_articles_without_cost(10);
    raise exception 'ÉCHEC 6 : le rôle logistique a lu le catalogue';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.get_skara_invoice(v_ctx.facture);
    raise exception 'ÉCHEC 6 : le rôle logistique a lu une facture';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000004';
do $$
declare v_ctx record; v_list jsonb;
begin
  select * into v_ctx from ctx;
  v_list := public.list_skara_invoices('{}'::jsonb);
  if (v_list->'totals'->>'pieces')::int <> 0 then
    raise exception 'ÉCHEC 7 : une autre organisation voit % pièce(s)',
      v_list->'totals'->>'pieces';
  end if;
  begin
    perform public.get_skara_invoice(v_ctx.facture);
    raise exception 'ÉCHEC 7 : lecture interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 6 et 7 : permissions et isolation tenues.';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 8. Cloisonnement par magasin (migration 17)
--
-- L'administrateur dépose une pièce sur HERBLAY. Le responsable de LISSES ne
-- doit ni la compter, ni pouvoir la demander, ni obtenir le journal.
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000001';
do $$
begin
  perform public.import_skara_file(jsonb_build_object(
    'kind', 'liste_factures',
    'store_id', '00000000-0000-4000-a000-000000000202',
    'file_name', 'herblay.csv', 'content_hash', 'cloisonnement-herblay',
    'period', jsonb_build_object('start', '2026-09-03', 'end', '2026-09-03'),
    'prefixes', jsonb_build_array('FH'),
    'rows', jsonb_build_array(
      jsonb_build_object('doc_type', 'facture', 'number', 'FH20260900001',
        'row_key', 'FH20260900001', 'accounting_state', 'non_exportee',
        'date', '2026-09-03', 'client_label', 'Client Herblay',
        'seller_label', 'Vendeur H', 'total_ttc', '1000.00',
        'total_ht', '833.333', 'vat', '166.667', 'margin_skara', '400.000',
        'remaining_due', '0')),
    'anomalies', '[]'::jsonb));
end $$;
reset role;

alter table ctx add column herblay uuid;
update ctx set herblay = (select id from public.skara_invoices
                          where number = 'FH20260900001');

set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000002';
do $$
declare v_ctx record; v_list jsonb; v_ctrl jsonb;
begin
  select * into v_ctx from ctx;

  -- Sans filtre : la pièce d'Herblay ne doit PAS entrer dans les totaux.
  v_list := public.list_skara_invoices('{}'::jsonb);
  if (v_list->'totals'->>'pieces')::int <> 4 then
    raise exception 'ÉCHEC 8 : % pièce(s) au lieu de 4, Herblay a fuité',
      v_list->'totals'->>'pieces';
  end if;
  if (v_list->'totals'->>'ttc')::numeric <> 1271 then
    raise exception 'ÉCHEC 8 : total % au lieu de 1271, Herblay a fuité',
      v_list->'totals'->>'ttc';
  end if;

  -- Magasin explicitement demandé mais non accordé : REFUS franc, pas une
  -- réponse vide qui laisserait croire à une absence de données.
  begin
    perform public.list_skara_invoices(jsonb_build_object(
      'store_id', '00000000-0000-4000-a000-000000000202'));
    raise exception 'ÉCHEC 8 : un magasin non accordé a été accepté';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- La pièce elle-même, demandée par son identifiant, reste refusée.
  begin
    perform public.get_skara_invoice(v_ctx.herblay);
    raise exception 'ÉCHEC 8 : pièce d''un autre magasin lue par identifiant';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  -- Contrôle mensuel : un seul magasin, et journal masqué.
  v_ctrl := public.get_skara_monthly_control(null, null);
  if exists (select 1 from jsonb_array_elements(v_ctrl->'stores') e
             where e->>'magasin' = 'Trust Herblay') then
    raise exception 'ÉCHEC 8 : Herblay apparaît dans le contrôle mensuel';
  end if;
  if (v_ctrl->>'journal_visible')::boolean is not false then
    raise exception 'ÉCHEC 8 : journal annoncé visible sans vision globale';
  end if;
  if jsonb_array_length(v_ctrl->'journal') <> 0 then
    raise exception 'ÉCHEC 8 : le journal comptable a fuité';
  end if;

  -- L'historique des imports ne montre pas celui d'Herblay.
  if exists (select 1 from jsonb_array_elements(public.list_skara_imports(50)) e
             where e->>'file_name' = 'herblay.csv') then
    raise exception 'ÉCHEC 8 : import d''un autre magasin visible';
  end if;
end $$;
reset role;

-- L'administrateur, lui, voit les deux magasins et son journal.
set role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-4000-d100-000000000001';
do $$
declare v_list jsonb; v_ctrl jsonb;
begin
  v_list := public.list_skara_invoices('{}'::jsonb);
  if (v_list->'totals'->>'pieces')::int <> 5 then
    raise exception 'ÉCHEC 8 : l''administrateur voit % pièce(s) au lieu de 5',
      v_list->'totals'->>'pieces';
  end if;
  v_ctrl := public.get_skara_monthly_control(null, null);
  if (v_ctrl->>'journal_visible')::boolean is not true then
    raise exception 'ÉCHEC 8 : journal masqué à la vision globale';
  end if;
  if jsonb_array_length(v_ctrl->'journal') = 0 then
    raise exception 'ÉCHEC 8 : journal vide pour la vision globale';
  end if;
  raise notice 'OK 8 : cloisonnement par magasin tenu, journal réservé.';
end $$;
reset role;

rollback;
