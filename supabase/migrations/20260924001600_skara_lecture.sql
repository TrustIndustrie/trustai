-- ============================================================================
-- TRUST AI — Migration 16 : LECTURE DES DONNÉES SKARA (lot 1B)
-- ----------------------------------------------------------------------------
-- Aucune table, aucune écriture : quatre fonctions de LECTURE seulement.
-- Elles servent la consultation des factures et l'écran de contrôle mensuel.
--
-- Le contrôle mensuel est l'instrument qui donne confiance à tout le reste :
-- il compare, mois par mois, ce que dit la liste des factures et ce que dit
-- le journal comptable. Ces deux sources sont produites indépendamment par
-- Skara, donc leur concordance vaut preuve. Sur les fichiers réels, l'écart
-- s'explique entièrement par les pièces NON ÉMISES, absentes de la
-- comptabilité : c'est exactement ce que la fonction rend visible.
--
-- Deux indicateurs de fiabilité accompagnent chaque mois :
--
--   * la part de factures SANS VENDEUR — renseigné dans 3 % des cas chez
--     vous, ce qui interdit toute analyse par vendeur ;
--   * les factures dont la MARGE ÉGALE le hors taxes, signe que le coût
--     d'achat de l'article n'est pas renseigné. Elles représentaient 12,5 %
--     du chiffre d'affaires sur l'échantillon, et la quatrième fonction
--     liste les articles à corriger.
--
-- Permission de lecture : `voir_acquisition`. Les fonctions sont `stable` :
-- elles ne peuvent rien écrire, par construction.
--
-- Rejouable et transactionnelle.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Liste des factures
-- ===========================================================================

create or replace function public.list_skara_invoices(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_store uuid := nullif(p_filters->>'store_id', '')::uuid;
  v_from date := nullif(p_filters->>'from', '')::date;
  v_to date := nullif(p_filters->>'to', '')::date;
  v_doc_type text := nullif(p_filters->>'doc_type', '');
  v_state text := nullif(p_filters->>'accounting_state', '');
  v_search text := nullif(trim(coalesce(p_filters->>'search', '')), '');
  v_limit integer := least(greatest(coalesce((p_filters->>'limit')::integer, 100), 1), 500);
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

  return jsonb_build_object(
    'totals', coalesce((
      select jsonb_build_object(
               'pieces', count(*),
               'avoirs', count(*) filter (where i.doc_type = 'avoir'),
               'non_emises', count(*) filter (where i.doc_type = 'non_emise'),
               'ttc', coalesce(sum(i.total_ttc), 0),
               'ht', coalesce(sum(i.total_ht), 0),
               'vat', coalesce(sum(i.vat), 0),
               'margin', coalesce(sum(i.margin_skara), 0),
               'remaining_due', coalesce(sum(i.remaining_due), 0))
      from public.skara_invoices i
      where i.organization_id = v_org
        and (v_store is null or i.store_id = v_store)
        and (v_from is null or i.invoice_date >= v_from)
        and (v_to is null or i.invoice_date <= v_to)
        and (v_doc_type is null or i.doc_type = v_doc_type)
        and (v_state is null or i.accounting_state = v_state)
        and (v_search is null
             or i.number ilike '%' || v_search || '%'
             or i.client_label ilike '%' || v_search || '%')),
      jsonb_build_object('pieces', 0)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.invoice_date desc nulls last, x.number)
      from (
        select i.id, i.number, i.doc_type, i.accounting_state, i.invoice_date,
               i.client_label, i.seller_label, i.total_ttc, i.total_ht, i.vat,
               i.margin_skara, i.remaining_due, i.eco_ttc, i.service_ttc,
               s.name as store_name,
               -- Marge creuse : le coût d'achat de l'article manque chez Skara.
               (i.total_ht is not null and i.margin_skara is not null
                and abs(i.margin_skara - i.total_ht) < 0.01) as margin_hollow,
               (select count(*) from public.skara_invoice_lines l
                 where l.organization_id = i.organization_id
                   and l.store_id = i.store_id
                   and l.invoice_number = i.number) as line_count
        from public.skara_invoices i
        join public.stores s on s.id = i.store_id
        where i.organization_id = v_org
          and (v_store is null or i.store_id = v_store)
          and (v_from is null or i.invoice_date >= v_from)
          and (v_to is null or i.invoice_date <= v_to)
          and (v_doc_type is null or i.doc_type = v_doc_type)
          and (v_state is null or i.accounting_state = v_state)
          and (v_search is null
               or i.number ilike '%' || v_search || '%'
               or i.client_label ilike '%' || v_search || '%')
        order by i.invoice_date desc nulls last, i.number
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 2. Une facture et ses lignes
-- ===========================================================================

create or replace function public.get_skara_invoice(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.skara_invoices%rowtype;
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

  select * into v_row from public.skara_invoices where id = p_id;
  if not found then
    raise exception 'Pièce introuvable.';
  end if;
  if v_row.organization_id <> v_org then
    raise exception 'Accès refusé : cette pièce appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'number', v_row.number,
    'doc_type', v_row.doc_type,
    'accounting_state', v_row.accounting_state,
    'invoice_date', v_row.invoice_date,
    'client_label', v_row.client_label,
    'seller_label', v_row.seller_label,
    'total_ttc', v_row.total_ttc,
    'total_ht', v_row.total_ht,
    'vat', v_row.vat,
    'margin_skara', v_row.margin_skara,
    'remaining_due', v_row.remaining_due,
    'eco_ttc', v_row.eco_ttc,
    'service_ttc', v_row.service_ttc,
    'store_name', (select s.name from public.stores s where s.id = v_row.store_id),
    'margin_hollow', (v_row.total_ht is not null and v_row.margin_skara is not null
                      and abs(v_row.margin_skara - v_row.total_ht) < 0.01),
    -- Une facture entièrement annulée n'apparaît QUE sous la forme de son
    -- avoir dans la liste Skara, alors que l'export des lignes la montre au
    -- positif. On signale donc la contrepartie quand elle existe.
    'counterpart', (
      select jsonb_build_object('id', c.id, 'doc_type', c.doc_type,
                                'total_ttc', c.total_ttc, 'invoice_date', c.invoice_date)
      from public.skara_invoices c
      where c.organization_id = v_row.organization_id
        and c.store_id = v_row.store_id
        and c.number = v_row.number
        and c.doc_type <> v_row.doc_type
      limit 1),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_index', l.line_index,
               'label', l.label,
               'quantity', l.quantity,
               'total_price_ttc', l.total_price_ttc,
               'nature', coalesce(l.nature_confirmed, l.nature_proposed),
               'nature_confirmed', l.nature_confirmed is not null)
             order by l.line_index)
      from public.skara_invoice_lines l
      where l.organization_id = v_row.organization_id
        and l.store_id = v_row.store_id
        and l.invoice_number = v_row.number), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 3. Contrôle mensuel, et recoupement avec le journal comptable
-- ===========================================================================

create or replace function public.get_skara_monthly_control(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

  return jsonb_build_object(
    -- Un bloc par mois et par magasin, d'après la liste des factures.
    'stores', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.mois desc, x.magasin)
      from (
        select to_char(date_trunc('month', i.invoice_date), 'YYYY-MM') as mois,
               s.name as magasin,
               count(*) filter (where i.doc_type = 'facture') as factures,
               count(*) filter (where i.doc_type = 'avoir') as avoirs,
               count(*) filter (where i.doc_type = 'non_emise') as non_emises,
               coalesce(sum(i.total_ttc), 0) as ttc,
               coalesce(sum(i.total_ht), 0) as ht,
               coalesce(sum(i.vat), 0) as tva,
               coalesce(sum(i.margin_skara), 0) as marge,
               coalesce(sum(i.remaining_due), 0) as reste_a_regler,
               count(*) filter (where i.seller_label is null) as sans_vendeur,
               count(*) filter (
                 where i.total_ht is not null and i.margin_skara is not null
                   and abs(i.margin_skara - i.total_ht) < 0.01) as marge_creuse,
               coalesce(sum(i.total_ht) filter (
                 where i.total_ht is not null and i.margin_skara is not null
                   and abs(i.margin_skara - i.total_ht) < 0.01), 0) as marge_creuse_ht
        from public.skara_invoices i
        join public.stores s on s.id = i.store_id
        where i.organization_id = v_org
          and i.invoice_date is not null
          and (p_from is null or i.invoice_date >= p_from)
          and (p_to is null or i.invoice_date <= p_to)
        group by 1, 2
      ) x), '[]'::jsonb),
    -- Un bloc par mois, d'après le journal comptable. Le journal ne porte pas
    -- le magasin : le recoupement se fait donc au niveau de l'organisation.
    'journal', coalesce((
      select jsonb_agg(row_to_json(y)::jsonb order by y.mois desc)
      from (
        select to_char(date_trunc('month', e.entry_date), 'YYYY-MM') as mois,
               count(*) as ecritures,
               coalesce(sum(e.debit), 0) as debit,
               coalesce(sum(e.credit), 0) as credit,
               -- Comptes de produits (classe 7) : ventes nettes des avoirs.
               coalesce(sum(e.credit - e.debit) filter (
                 where e.general_account like '7%'), 0) as ventes,
               -- TVA collectée (comptes 4457).
               coalesce(sum(e.credit - e.debit) filter (
                 where e.general_account like '4457%'), 0) as tva,
               -- Comptes clients (411) : au débit, donc signe inversé.
               coalesce(sum(e.debit - e.credit) filter (
                 where e.general_account like '411%'), 0) as clients
        from public.skara_journal_entries e
        where e.organization_id = v_org
          and e.entry_date is not null
          and (p_from is null or e.entry_date >= p_from)
          and (p_to is null or e.entry_date <= p_to)
        group by 1
      ) y), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('kind', i.kind, 'nombre', i.nombre))
      from (select kind, count(*) as nombre from public.skara_imports
            where organization_id = v_org group by kind) i), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 4. Articles sans coût exploitable
-- ===========================================================================

-- La liste des fiches à compléter dans Skara pour que la marge redevienne
-- calculable. Classée par prix de vente décroissant : à défaut du chiffre
-- d'affaires généré, qui exigerait un rattachement des lignes aux articles,
-- c'est le meilleur indicateur d'impact disponible aujourd'hui.
create or replace function public.list_skara_articles_without_cost(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

  return jsonb_build_object(
    'totals', coalesce((
      select jsonb_build_object(
               'articles', count(*),
               'sans_cout', count(*) filter (where net_origin = 'absent'),
               'reconstruits', count(*) filter (where net_origin = 'reconstruit'),
               'fournis', count(*) filter (where net_origin = 'skara'))
      from public.skara_articles where organization_id = v_org),
      jsonb_build_object('articles', 0)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.sale_price_ttc desc nulls last)
      from (
        select a.reference, a.title, a.supplier_label, a.family_label,
               a.collection_label, a.sale_price_ttc, a.purchase_gross,
               a.net_origin
        from public.skara_articles a
        where a.organization_id = v_org and a.net_origin = 'absent'
        order by a.sale_price_ttc desc nulls last
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 5. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_skara_invoices(jsonb)',
    'public.get_skara_invoice(uuid)',
    'public.get_skara_monthly_control(date, date)',
    'public.list_skara_articles_without_cost(integer)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
