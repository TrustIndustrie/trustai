-- ============================================================================
-- TRUST AI — Migration 17 : CLOISONNEMENT PAR MAGASIN DES LECTURES SKARA
-- ----------------------------------------------------------------------------
-- Correction d'un défaut introduit par les migrations 15 et 16.
--
-- Les fonctions de lecture Skara vérifiaient la permission `voir_acquisition`
-- puis filtraient sur la seule ORGANISATION. Or `responsable_magasin` détient
-- `voir_acquisition` sans détenir `voir_tous_magasins` : un responsable
-- pouvait donc appeler ces fonctions en désignant un autre magasin, ou sans
-- désigner de magasin du tout, et recevoir en retour le chiffre d'affaires,
-- les marges, le reste à régler et les libellés clients de magasins qui ne
-- sont pas les siens.
--
-- Ces fonctions étant `security definer`, elles contournent la sécurité au
-- niveau des lignes : le cloisonnement doit y être écrit explicitement. C'est
-- ce que fait cette migration, en s'appuyant sur les magasins réellement
-- accordés au profil dans `user_store_access`.
--
-- Trois règles tenues ici :
--
--   * un magasin explicitement demandé mais non autorisé provoque un REFUS
--     franc, pas une réponse vide, qui laisserait croire à une absence de
--     données ;
--   * sans magasin demandé, la lecture se limite aux magasins autorisés ;
--   * le JOURNAL COMPTABLE ne porte pas le magasin. Il ne peut donc pas être
--     cloisonné, et n'est servi qu'aux profils ayant la vision globale. La
--     réponse le dit, plutôt que de renvoyer un tableau vide indistinguable
--     d'un journal non importé.
--
-- Aucune table, aucune écriture, aucune donnée modifiée. Rejouable.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Magasins autorisés au profil courant
-- ===========================================================================

-- Une seule lecture de `user_store_access`, réutilisée par chaque fonction.
-- Le tableau vide signifie « aucun magasin », jamais « tous les magasins ».
create or replace function app.allowed_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(usa.store_id), '{}')::uuid[]
  from public.user_store_access usa
  where usa.profile_id = auth.uid()
$$;

revoke all on function app.allowed_store_ids() from public;
revoke all on function app.allowed_store_ids() from anon;

-- ===========================================================================
-- 2. Liste des factures
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
  v_all boolean;
  v_allowed uuid[];
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
  v_all := app.has_permission('voir_tous_magasins');
  v_allowed := case when v_all then '{}'::uuid[] else app.allowed_store_ids() end;

  if v_store is not null and not v_all and not (v_store = any(v_allowed)) then
    raise exception 'Accès refusé : ce magasin ne vous est pas accordé.'
      using errcode = '42501';
  end if;

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
        and (v_all or i.store_id = any (v_allowed))
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
               (i.total_ht is not null and i.margin_skara is not null
                and abs(i.margin_skara - i.total_ht) < 0.01) as margin_hollow,
               (select count(*) from public.skara_invoice_lines l
                 where l.organization_id = i.organization_id
                   and l.store_id = i.store_id
                   and l.invoice_number = i.number) as line_count
        from public.skara_invoices i
        join public.stores s on s.id = i.store_id
        where i.organization_id = v_org
          and (v_all or i.store_id = any (v_allowed))
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
-- 3. Une facture et ses lignes
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
  -- Même message et même code que pour une autre organisation : un profil
  -- non autorisé n'apprend rien de l'existence de la pièce.
  if not app.can_access_store(v_row.store_id) then
    raise exception 'Accès refusé : cette pièce appartient à un magasin qui ne vous est pas accordé.'
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
-- 4. Contrôle mensuel
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
  v_all boolean;
  v_allowed uuid[];
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();
  v_all := app.has_permission('voir_tous_magasins');
  v_allowed := case when v_all then '{}'::uuid[] else app.allowed_store_ids() end;

  return jsonb_build_object(
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
          and (v_all or i.store_id = any (v_allowed))
          and i.invoice_date is not null
          and (p_from is null or i.invoice_date >= p_from)
          and (p_to is null or i.invoice_date <= p_to)
        group by 1, 2
      ) x), '[]'::jsonb),
    -- Le journal ne porte pas le magasin : il n'est pas cloisonnable, donc
    -- il n'est servi qu'à la vision globale. Le drapeau permet à l'écran de
    -- distinguer « journal masqué » de « journal non importé ».
    'journal_visible', v_all,
    'journal', case when not v_all then '[]'::jsonb else coalesce((
      select jsonb_agg(row_to_json(y)::jsonb order by y.mois desc)
      from (
        select to_char(date_trunc('month', e.entry_date), 'YYYY-MM') as mois,
               count(*) as ecritures,
               coalesce(sum(e.debit), 0) as debit,
               coalesce(sum(e.credit), 0) as credit,
               coalesce(sum(e.credit - e.debit) filter (
                 where e.general_account like '7%'), 0) as ventes,
               coalesce(sum(e.credit - e.debit) filter (
                 where e.general_account like '4457%'), 0) as tva,
               coalesce(sum(e.debit - e.credit) filter (
                 where e.general_account like '411%'), 0) as clients
        from public.skara_journal_entries e
        where e.organization_id = v_org
          and e.entry_date is not null
          and (p_from is null or e.entry_date >= p_from)
          and (p_to is null or e.entry_date <= p_to)
        group by 1
      ) y), '[]'::jsonb) end,
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('kind', i.kind, 'nombre', i.nombre))
      from (select i2.kind, count(*) as nombre
            from public.skara_imports i2
            where i2.organization_id = v_org
              and (v_all or i2.store_id is null or i2.store_id = any (v_allowed))
            group by i2.kind) i), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 5. Historique des imports
-- ===========================================================================

create or replace function public.list_skara_imports(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_all boolean;
  v_allowed uuid[];
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();
  v_all := app.has_permission('voir_tous_magasins');
  v_allowed := case when v_all then '{}'::uuid[] else app.allowed_store_ids() end;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.imported_at desc)
    from (
      select i.id, i.kind, i.file_name, i.period_start, i.period_end,
             i.rows_received, i.rows_created, i.rows_updated, i.imported_at,
             i.prefixes, s.name as store_name,
             (select count(*) from public.skara_import_anomalies a
               where a.import_id = i.id) as anomalies
      from public.skara_imports i
      left join public.stores s on s.id = i.store_id
      where i.organization_id = v_org
        -- Un import sans magasin (catalogue, journal) reste visible : il ne
        -- porte pas de chiffre par magasin.
        and (v_all or i.store_id is null or i.store_id = any (v_allowed))
      order by i.imported_at desc
      limit v_limit
    ) x), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- 6. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_skara_invoices(jsonb)',
    'public.get_skara_invoice(uuid)',
    'public.get_skara_monthly_control(date, date)',
    'public.list_skara_imports(integer)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
