-- ============================================================================
-- TRUST AI — RETOUR ARRIÈRE de la migration 11 (onglets multiples, 3 sorties)
--
-- Rangé dans `supabase/rollbacks/` et NON dans `supabase/migrations/` : tout
-- outil parcourant le dossier des migrations l'exécuterait sinon
-- automatiquement. À lancer UNIQUEMENT à la demande, dans le SQL Editor.
-- ============================================================================
--
--  ⚠️  AVERTISSEMENT — À LIRE AVANT TOUTE EXÉCUTION  ⚠️
--
--  Ce script retire ce que la migration 11 a ajouté :
--     * les colonnes `exit_channel`, `exit_at` et `freight_ref` de
--       `logistics_lines` — donc l'information « par quel chemin le client a
--       été servi » et les numéros d'affrètement ;
--     * la colonne `client_carriers` de `recap_sources` ;
--     * les fonctions `list_recap_sources` et `set_recap_source_active`.
--
--  Il ne SUPPRIME AUCUNE LIGNE. En revanche, si PLUSIEURS ONGLETS ont été
--  configurés, l'application redevient incapable de les distinguer : la
--  contrainte d'unicité sur le libellé est rétablie, et elle ÉCHOUERA tant
--  que deux sources partagent le même libellé.
--
--  Contrôle à exécuter AVANT (les deux doivent valoir 0 pour un retour sans
--  perte fonctionnelle) :
--
--     select
--       (select count(*) from public.logistics_lines
--         where exit_channel is not null)          as sorties_qualifiees,
--       (select count(*) - count(distinct label)
--          from public.recap_sources)              as libelles_en_double;
--
--  Si `libelles_en_double` n'est pas 0, renommez d'abord les sources :
--     update public.recap_sources set label = label || ' — ' || sheet_name;
-- ============================================================================

begin;

-- 1. Fonctions propres à la migration 11.
drop function if exists public.set_recap_source_active(uuid, boolean);
drop function if exists public.list_recap_sources();
drop function if exists public.list_logistics_lines(
  text, text, text, uuid, boolean, integer, integer, uuid, text);

-- 2. Rétablir la lecture des lignes dans sa version de la migration 10
--    (sans filtre par onglet ni par chemin de sortie).
create or replace function public.list_logistics_lines(
  p_search text default null,
  p_stage text default null,
  p_supplier text default null,
  p_warehouse_id uuid default null,
  p_only_anomalies boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (app.has_permission('gerer_livraisons') or app.has_permission('gerer_logistique')) then
    raise exception 'Votre rôle ne permet pas de consulter les lignes logistiques.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();

  with filtered as (
    select l.*,
           (select count(*) from public.logistics_anomalies a
            where a.logistics_line_id = l.id and a.resolved_at is null) as open_anomalies
    from public.logistics_lines l
    where l.organization_id = v_org
      and (p_stage is null or l.stage = p_stage)
      and (p_supplier is null or l.supplier_label = p_supplier)
      and (p_warehouse_id is null
           or l.destination_warehouse_id = p_warehouse_id
           or l.current_warehouse_id = p_warehouse_id)
      and (v_search is null
           or l.designation ilike '%' || v_search || '%'
           or coalesce(l.customer_label, '') ilike '%' || v_search || '%'
           or coalesce(l.supplier_reference, '') ilike '%' || v_search || '%'
           or coalesce(l.supplier_order_ref, '') ilike '%' || v_search || '%'
           or coalesce(l.recap_row_id, '') ilike '%' || v_search || '%')
  ), counted as (
    select * from filtered
    where not p_only_anomalies or open_anomalies > 0 or missing_since is not null
  ), page as (
    select c.id, c.recap_row_id, c.recap_date, c.supplier_label,
           c.supplier_reference, c.supplier_order_ref, c.designation, c.quantity,
           c.customer_label, c.expected_at, c.comments, c.stage,
           c.destination_confidence, c.missing_since, c.last_seen_at,
           c.last_changed_at, c.open_anomalies,
           (select name from public.warehouses w where w.id = c.destination_warehouse_id)
             as destination_label,
           (select name from public.warehouses w where w.id = c.current_warehouse_id)
             as current_label
    from counted c
    order by c.recap_date desc nulls last, c.designation
    limit v_limit offset v_offset
  )
  select
    (select count(*)::integer from counted),
    coalesce((select jsonb_agg(to_jsonb(p)
                               order by p.recap_date desc nulls last, p.designation)
              from page p), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- 3. Rétablir `get_recap_source()` (première source active).
create or replace function public.get_recap_source()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.recap_sources%rowtype;
  v_last jsonb;
begin
  if not (app.has_permission('importer_recap') or app.has_permission('gerer_livraisons')) then
    raise exception 'Votre rôle ne permet pas de consulter la configuration du récapitulatif.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();

  select * into v_row from public.recap_sources
  where organization_id = v_org and active
  order by created_at asc limit 1;

  if not found then
    return null;
  end if;

  select to_jsonb(r) into v_last
  from (
    select id, trigger_type, started_at, finished_at, rows_read, rows_created,
           rows_updated, rows_ignored, errors_count, report
    from public.recap_reads
    where source_id = v_row.id
    order by started_at desc
    limit 1
  ) r;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'label', v_row.label,
    'spreadsheet_id', v_row.spreadsheet_id,
    'sheet_name', v_row.sheet_name,
    'header_row', v_row.header_row,
    'id_column', v_row.id_column,
    'column_mapping', v_row.column_mapping,
    'last_read_at', v_row.last_read_at,
    'last_read_status', v_row.last_read_status,
    'last_read', v_last);
end;
$$;

-- 4. Colonnes ajoutées (les données qu'elles portaient sont perdues).
alter table public.logistics_lines
  drop column if exists exit_channel,
  drop column if exists exit_at,
  drop column if exists freight_ref;

alter table public.recap_sources
  drop column if exists client_carriers;

drop index if exists public.logistics_lines_freight_idx;
drop index if exists public.logistics_lines_exit_idx;
drop index if exists public.recap_sources_sheet_key;

-- 5. Rétablir l'unicité du libellé (échoue si deux sources le partagent —
--    c'est volontaire : mieux vaut un refus clair qu'une perte silencieuse).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recap_sources_organization_id_label_key'
  ) then
    alter table public.recap_sources
      add constraint recap_sources_organization_id_label_key
      unique (organization_id, label);
  end if;
end $$;

-- 6. Droits d'exécution des fonctions rétablies.
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_recap_source()',
    'public.list_logistics_lines(text, text, text, uuid, boolean, integer, integer)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Contrôle après exécution :
--
--   select count(*) as colonnes_phase_11
--   from information_schema.columns
--   where table_schema = 'public'
--     and (table_name = 'logistics_lines'
--          and column_name in ('exit_channel', 'exit_at', 'freight_ref'))
--      or (table_name = 'recap_sources' and column_name = 'client_carriers');
--   -- attendu : 0
-- ---------------------------------------------------------------------------
