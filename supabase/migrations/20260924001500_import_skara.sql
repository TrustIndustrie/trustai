-- ============================================================================
-- TRUST AI — Migration 15 : IMPORT DES EXPORTS SKARA (lot 1A)
-- ----------------------------------------------------------------------------
-- Skara reste l'outil officiel : ventes, clients, factures, règlements. TRUST
-- AI en lit les exports pour disposer d'une vue INTERNE, plus riche, et
-- n'écrit JAMAIS vers Skara.
--
-- Quatre exports, quatre rôles :
--
--   * `liste_factures`   — montants, TVA, marge Skara, reste à régler,
--                          vendeur, éco-participation, service ;
--   * `lignes_factures`  — ce qui a été vendu, article par article ;
--   * `catalogue`        — fournisseur, référence, coût d'achat, remises,
--                          coefficient, prix de vente, famille ;
--   * `journal_comptable`— écritures équilibrées, codées par compte.
--
-- PRINCIPES TENUS PAR LA BASE, pas par l'interface :
--
--   1. les données de Skara ne sont jamais modifiées ni recalculées : les
--      montants arrivent en chaînes et sont convertis une seule fois. Le hors
--      taxes de Skara vaut 916,667 pour 1 100 toutes taxes, et tout recalcul
--      créerait des écarts inexplicables avec le comptable ;
--   2. un fichier déjà importé ne produit rien : l'empreinte de son contenu
--      est unique par organisation. Les exports se font à la main, donc les
--      chevauchements de période sont certains ;
--   3. une anomalie bloquante refuse l'écriture. Un fichier dont le total de
--      pied ne correspond pas à ses lignes n'entre pas ;
--   4. aucune création automatique de client ni de produit du référentiel :
--      les libellés Skara sont stockés tels quels, le rattachement viendra
--      d'une décision humaine ;
--   5. pour une même période, les fichiers s'ADDITIONNENT. Un mois de journal
--      arrive en plusieurs vagues chez Skara, donc le dernier fichier n'est
--      jamais la vérité à lui seul.
--
-- Rejouable et transactionnelle, comme les migrations 9 à 13.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Préfixe de numérotation par magasin
-- ===========================================================================

-- Les numéros de facture Skara commencent par deux lettres qui désignent le
-- magasin (FC, FL, FM observés). Renseigner ce préfixe permet à l'import de
-- REFUSER un fichier étiqueté du mauvais magasin, qui est l'erreur humaine la
-- plus probable. Tant qu'il n'est pas renseigné, l'import se contente d'un
-- avertissement.
alter table public.stores
  add column if not exists skara_invoice_prefix text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'stores_skara_prefix_check') then
    alter table public.stores
      add constraint stores_skara_prefix_check
      check (skara_invoice_prefix is null
             or skara_invoice_prefix ~ '^[A-Z]{2}$');
  end if;
end $$;

create unique index if not exists stores_skara_prefix_key
  on public.stores (organization_id, skara_invoice_prefix)
  where skara_invoice_prefix is not null;

-- ===========================================================================
-- 2. Un enregistrement par fichier importé
-- ===========================================================================

create table if not exists public.skara_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in (
    'liste_factures', 'lignes_factures', 'catalogue', 'journal_comptable')),
  -- Nul pour le journal, qui est multi-magasins, et pour le catalogue.
  store_id uuid references public.stores(id),
  file_name text not null,
  content_hash text not null,
  period_start date,
  period_end date,
  rows_received integer not null default 0 check (rows_received >= 0),
  rows_created integer not null default 0 check (rows_created >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  footer_totals jsonb,
  computed_totals jsonb,
  prefixes text[] not null default '{}',
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now()
);

-- Le MÊME fichier ne s'importe qu'une fois : c'est la garde d'idempotence.
create unique index if not exists skara_imports_content_key
  on public.skara_imports (organization_id, content_hash);
create index if not exists skara_imports_kind_idx
  on public.skara_imports (organization_id, kind, imported_at desc);

-- ===========================================================================
-- 3. Factures et avoirs
-- ===========================================================================

create table if not exists public.skara_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  doc_type text not null check (doc_type in ('facture', 'avoir', 'non_emise')),
  -- Nul pour une pièce non émise, qui n'a pas de numéro chez Skara.
  number text,
  -- Clé de repli déterministe pour ces pièces, afin que le réimport soit sûr.
  row_key text not null,
  accounting_state text
    check (accounting_state is null
           or accounting_state in ('exportee', 'non_exportee')),
  invoice_date date,
  client_label text,
  seller_label text,
  total_ttc numeric(16, 4),
  total_ht numeric(16, 4),
  vat numeric(16, 4),
  margin_skara numeric(16, 4),
  remaining_due numeric(16, 4),
  eco_ttc numeric(16, 4),
  service_ttc numeric(16, 4),
  import_id uuid not null references public.skara_imports(id) on delete restrict,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists skara_invoices_key
  on public.skara_invoices (organization_id, store_id, doc_type, row_key);
create index if not exists skara_invoices_date_idx
  on public.skara_invoices (organization_id, invoice_date);
create index if not exists skara_invoices_number_idx
  on public.skara_invoices (organization_id, number)
  where number is not null;

-- ===========================================================================
-- 4. Lignes de factures
-- ===========================================================================

create table if not exists public.skara_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  invoice_number text not null,
  line_index integer not null check (line_index >= 1),
  line_date date,
  label text not null,
  quantity integer,
  unit_weight numeric(16, 4),
  total_weight numeric(16, 4),
  volume numeric(16, 4),
  total_volume numeric(16, 4),
  total_price_ttc numeric(16, 4),
  -- Une ligne n'est pas toujours un produit : remise, service, éco. La
  -- nature est PROPOSÉE par la lecture et confirmée par un humain.
  nature_proposed text not null
    check (nature_proposed in ('produit', 'remise', 'service', 'eco')),
  nature_confirmed text
    check (nature_confirmed is null
           or nature_confirmed in ('produit', 'remise', 'service', 'eco')),
  import_id uuid not null references public.skara_imports(id) on delete restrict,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists skara_invoice_lines_key
  on public.skara_invoice_lines (organization_id, store_id, invoice_number, line_index);
create index if not exists skara_invoice_lines_invoice_idx
  on public.skara_invoice_lines (organization_id, invoice_number);

-- ===========================================================================
-- 5. Catalogue des articles
-- ===========================================================================

create table if not exists public.skara_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reference text not null,
  supplier_key text,
  supplier_label text,
  supplier_reference text,
  collection_key text,
  collection_label text,
  title text,
  category text,
  color text,
  family_key text,
  family_label text,
  subfamily_key text,
  subfamily_label text,
  purchase_gross numeric(16, 4),
  discount1 numeric(9, 4),
  discount2 numeric(9, 4),
  discount3 numeric(9, 4),
  discount_global numeric(9, 4),
  coefficient numeric(12, 6),
  sale_price_ttc numeric(16, 4),
  -- Coût net tel que Skara le donne, et coût net RECONSTRUIT depuis le brut
  -- et les remises quand Skara se taît. Les deux cohabitent, et `net_origin`
  -- dit toujours lequel sert.
  purchase_net_given numeric(16, 4),
  purchase_net_computed numeric(16, 4),
  net_origin text not null
    check (net_origin in ('skara', 'reconstruit', 'absent')),
  eco_amount_ttc numeric(16, 4),
  available numeric(16, 4),
  dimension text,
  description text,
  import_id uuid not null references public.skara_imports(id) on delete restrict,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists skara_articles_key
  on public.skara_articles (organization_id, reference);
create index if not exists skara_articles_supplier_idx
  on public.skara_articles (organization_id, supplier_label);
create index if not exists skara_articles_sans_cout_idx
  on public.skara_articles (organization_id)
  where net_origin = 'absent';

-- ===========================================================================
-- 6. Journal comptable
-- ===========================================================================

create table if not exists public.skara_journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  journal_code text not null,
  entry_date date,
  auxiliary_account text,
  general_account text not null,
  piece text,
  label text,
  debit numeric(16, 4) not null default 0,
  credit numeric(16, 4) not null default 0,
  currency text,
  import_id uuid not null references public.skara_imports(id) on delete restrict,
  row_index integer not null check (row_index >= 0),
  raw jsonb,
  created_at timestamptz not null default now()
);

-- Un export comptable est un lot à consommation unique : la clé est donc le
-- fichier et le rang de la ligne, et non l'écriture elle-même.
create unique index if not exists skara_journal_entries_key
  on public.skara_journal_entries (organization_id, import_id, row_index);
create index if not exists skara_journal_entries_account_idx
  on public.skara_journal_entries (organization_id, general_account, entry_date);
create index if not exists skara_journal_entries_piece_idx
  on public.skara_journal_entries (organization_id, piece)
  where piece is not null;

-- ===========================================================================
-- 7. Anomalies constatées à l'import (ajout seul)
-- ===========================================================================

create table if not exists public.skara_import_anomalies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  import_id uuid not null references public.skara_imports(id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('info', 'avertissement', 'bloquant')),
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists skara_import_anomalies_import_idx
  on public.skara_import_anomalies (import_id, severity);

-- ===========================================================================
-- 8. Verrouillage des accès directs, comme les 14 tables précédentes
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'skara_imports',
    'skara_invoices',
    'skara_invoice_lines',
    'skara_articles',
    'skara_journal_entries',
    'skara_import_anomalies'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_direct_access', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (false) with check (false)',
                   t || '_no_direct_access', t);
  end loop;

  -- Un import et une anomalie ne se réécrivent pas : on réimporte.
  execute 'drop trigger if exists append_only_guard on public.skara_import_anomalies';
  execute 'create trigger append_only_guard
             before update or delete on public.skara_import_anomalies
             for each row execute function app.forbid_update_delete()';

  execute 'drop trigger if exists same_org_guard on public.skara_imports';
  execute $t$create trigger same_org_guard
             before insert or update on public.skara_imports
             for each row execute function app.assert_same_org(
               'store_id', 'store',
               'imported_by', 'profile')$t$;

  execute 'drop trigger if exists same_org_guard on public.skara_invoices';
  execute $t$create trigger same_org_guard
             before insert or update on public.skara_invoices
             for each row execute function app.assert_same_org(
               'store_id', 'store')$t$;

  execute 'drop trigger if exists same_org_guard on public.skara_invoice_lines';
  execute $t$create trigger same_org_guard
             before insert or update on public.skara_invoice_lines
             for each row execute function app.assert_same_org(
               'store_id', 'store')$t$;
end $$;

-- ===========================================================================
-- 9. Écriture, une fonction interne par nature de fichier
-- ===========================================================================
-- Chacune renvoie { created, updated } : le créé se déduit du nombre de
-- lignes présentes avant et après, le mis à jour du reste. Les quatre sont
-- INTERNES : seules les RPC « security definer » les appellent.

create or replace function app.skara_write_invoices(
  p_org uuid,
  p_import uuid,
  p_store uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
  v_affected bigint;
begin
  select count(*) into v_before from public.skara_invoices
  where organization_id = p_org and store_id = p_store;

  insert into public.skara_invoices (
    organization_id, store_id, doc_type, number, row_key, accounting_state,
    invoice_date, client_label, seller_label, total_ttc, total_ht, vat,
    margin_skara, remaining_due, eco_ttc, service_ttc, import_id, raw)
  select
    p_org, p_store,
    r->>'doc_type',
    nullif(r->>'number', ''),
    r->>'row_key',
    nullif(r->>'accounting_state', ''),
    nullif(r->>'date', '')::date,
    nullif(r->>'client_label', ''),
    nullif(r->>'seller_label', ''),
    nullif(r->>'total_ttc', '')::numeric,
    nullif(r->>'total_ht', '')::numeric,
    nullif(r->>'vat', '')::numeric,
    nullif(r->>'margin_skara', '')::numeric,
    nullif(r->>'remaining_due', '')::numeric,
    nullif(r->>'eco_ttc', '')::numeric,
    nullif(r->>'service_ttc', '')::numeric,
    p_import,
    r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  on conflict (organization_id, store_id, doc_type, row_key) do update
  set number = excluded.number,
      accounting_state = excluded.accounting_state,
      invoice_date = excluded.invoice_date,
      client_label = excluded.client_label,
      seller_label = excluded.seller_label,
      total_ttc = excluded.total_ttc,
      total_ht = excluded.total_ht,
      vat = excluded.vat,
      margin_skara = excluded.margin_skara,
      remaining_due = excluded.remaining_due,
      eco_ttc = excluded.eco_ttc,
      service_ttc = excluded.service_ttc,
      import_id = excluded.import_id,
      raw = excluded.raw,
      last_seen_at = now();
  get diagnostics v_affected = row_count;

  select count(*) into v_after from public.skara_invoices
  where organization_id = p_org and store_id = p_store;

  return jsonb_build_object(
    'created', v_after - v_before,
    'updated', v_affected - (v_after - v_before));
end;
$$;
revoke all on function app.skara_write_invoices(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function app.skara_write_invoice_lines(
  p_org uuid,
  p_import uuid,
  p_store uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
  v_affected bigint;
begin
  select count(*) into v_before from public.skara_invoice_lines
  where organization_id = p_org and store_id = p_store;

  insert into public.skara_invoice_lines (
    organization_id, store_id, invoice_number, line_index, line_date, label,
    quantity, unit_weight, total_weight, volume, total_volume,
    total_price_ttc, nature_proposed, import_id, raw)
  select
    p_org, p_store,
    r->>'invoice_number',
    (r->>'line_index')::integer,
    nullif(r->>'date', '')::date,
    coalesce(r->>'label', ''),
    nullif(r->>'quantity', '')::integer,
    nullif(r->>'unit_weight', '')::numeric,
    nullif(r->>'total_weight', '')::numeric,
    nullif(r->>'volume', '')::numeric,
    nullif(r->>'total_volume', '')::numeric,
    nullif(r->>'total_price_ttc', '')::numeric,
    r->>'nature_proposed',
    p_import,
    r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  on conflict (organization_id, store_id, invoice_number, line_index) do update
  set line_date = excluded.line_date,
      label = excluded.label,
      quantity = excluded.quantity,
      unit_weight = excluded.unit_weight,
      total_weight = excluded.total_weight,
      volume = excluded.volume,
      total_volume = excluded.total_volume,
      total_price_ttc = excluded.total_price_ttc,
      nature_proposed = excluded.nature_proposed,
      import_id = excluded.import_id,
      raw = excluded.raw,
      last_seen_at = now();
  get diagnostics v_affected = row_count;

  select count(*) into v_after from public.skara_invoice_lines
  where organization_id = p_org and store_id = p_store;

  return jsonb_build_object(
    'created', v_after - v_before,
    'updated', v_affected - (v_after - v_before));
end;
$$;
revoke all on function app.skara_write_invoice_lines(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function app.skara_write_articles(
  p_org uuid,
  p_import uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
  v_affected bigint;
begin
  select count(*) into v_before from public.skara_articles
  where organization_id = p_org;

  insert into public.skara_articles (
    organization_id, reference, supplier_key, supplier_label,
    supplier_reference, collection_key, collection_label, title, category,
    color, family_key, family_label, subfamily_key, subfamily_label,
    purchase_gross, discount1, discount2, discount3, discount_global,
    coefficient, sale_price_ttc, purchase_net_given, purchase_net_computed,
    net_origin, eco_amount_ttc, available, dimension, description,
    import_id, raw)
  select
    p_org,
    r->>'reference',
    nullif(r->>'supplier_key', ''),
    nullif(r->>'supplier_label', ''),
    nullif(r->>'supplier_reference', ''),
    nullif(r->>'collection_key', ''),
    nullif(r->>'collection_label', ''),
    nullif(r->>'title', ''),
    nullif(r->>'category', ''),
    nullif(r->>'color', ''),
    nullif(r->>'family_key', ''),
    nullif(r->>'family_label', ''),
    nullif(r->>'subfamily_key', ''),
    nullif(r->>'subfamily_label', ''),
    nullif(r->>'purchase_gross', '')::numeric,
    nullif(r->>'discount1', '')::numeric,
    nullif(r->>'discount2', '')::numeric,
    nullif(r->>'discount3', '')::numeric,
    nullif(r->>'discount_global', '')::numeric,
    nullif(r->>'coefficient', '')::numeric,
    nullif(r->>'sale_price_ttc', '')::numeric,
    nullif(r->>'purchase_net_given', '')::numeric,
    nullif(r->>'purchase_net_computed', '')::numeric,
    r->>'net_origin',
    nullif(r->>'eco_amount_ttc', '')::numeric,
    nullif(r->>'available', '')::numeric,
    nullif(r->>'dimension', ''),
    nullif(r->>'description', ''),
    p_import,
    r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  on conflict (organization_id, reference) do update
  set supplier_key = excluded.supplier_key,
      supplier_label = excluded.supplier_label,
      supplier_reference = excluded.supplier_reference,
      collection_key = excluded.collection_key,
      collection_label = excluded.collection_label,
      title = excluded.title,
      category = excluded.category,
      color = excluded.color,
      family_key = excluded.family_key,
      family_label = excluded.family_label,
      subfamily_key = excluded.subfamily_key,
      subfamily_label = excluded.subfamily_label,
      purchase_gross = excluded.purchase_gross,
      discount1 = excluded.discount1,
      discount2 = excluded.discount2,
      discount3 = excluded.discount3,
      discount_global = excluded.discount_global,
      coefficient = excluded.coefficient,
      sale_price_ttc = excluded.sale_price_ttc,
      purchase_net_given = excluded.purchase_net_given,
      purchase_net_computed = excluded.purchase_net_computed,
      net_origin = excluded.net_origin,
      eco_amount_ttc = excluded.eco_amount_ttc,
      available = excluded.available,
      dimension = excluded.dimension,
      description = excluded.description,
      import_id = excluded.import_id,
      raw = excluded.raw,
      last_seen_at = now();
  get diagnostics v_affected = row_count;

  select count(*) into v_after from public.skara_articles
  where organization_id = p_org;

  return jsonb_build_object(
    'created', v_after - v_before,
    'updated', v_affected - (v_after - v_before));
end;
$$;
revoke all on function app.skara_write_articles(uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function app.skara_write_journal(
  p_org uuid,
  p_import uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected bigint;
begin
  insert into public.skara_journal_entries (
    organization_id, journal_code, entry_date, auxiliary_account,
    general_account, piece, label, debit, credit, currency, import_id,
    row_index, raw)
  select
    p_org,
    r->>'journal_code',
    nullif(r->>'date', '')::date,
    nullif(r->>'auxiliary_account', ''),
    r->>'general_account',
    nullif(r->>'piece', ''),
    nullif(r->>'label', ''),
    coalesce(nullif(r->>'debit', '')::numeric, 0),
    coalesce(nullif(r->>'credit', '')::numeric, 0),
    nullif(r->>'currency', ''),
    p_import,
    (r->>'row_index')::integer,
    r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  on conflict (organization_id, import_id, row_index) do nothing;
  get diagnostics v_affected = row_count;

  return jsonb_build_object('created', v_affected, 'updated', 0);
end;
$$;
revoke all on function app.skara_write_journal(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ===========================================================================
-- 10. RPC d'import
-- ===========================================================================

create or replace function public.import_skara_file(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- MIGRATION 15 : écriture d'un export Skara déjà lu et contrôlé côté serveur.
--
-- La lecture du fichier se fait hors base, par des fonctions pures testées.
-- Cette RPC ne fait PAS confiance à cette lecture : elle revérifie les
-- anomalies bloquantes, l'unicité du fichier et la cohérence du magasin.
declare
  v_profile uuid;
  v_org uuid;
  v_kind text;
  v_store uuid;
  v_hash text;
  v_import uuid;
  v_rows jsonb;
  v_counts jsonb;
  v_blocking integer;
  v_existing public.skara_imports%rowtype;
  v_prefix text;
  v_payload_prefixes text[];
  v_anomalies jsonb;
  v_received integer;
begin
  v_profile := app.require_permission('administrer');
  v_org := app.current_org_id();

  v_kind := p_payload->>'kind';
  if v_kind not in ('liste_factures', 'lignes_factures', 'catalogue', 'journal_comptable') then
    raise exception 'Nature de fichier inconnue : « % ».', coalesce(v_kind, 'absente');
  end if;

  v_hash := nullif(trim(coalesce(p_payload->>'content_hash', '')), '');
  if v_hash is null then
    raise exception 'Empreinte du fichier manquante : import refusé.';
  end if;

  v_rows := coalesce(p_payload->'rows', '[]'::jsonb);
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Le fichier lu ne fournit pas de tableau de lignes.';
  end if;
  v_received := jsonb_array_length(v_rows);

  v_anomalies := coalesce(p_payload->'anomalies', '[]'::jsonb);
  select count(*) into v_blocking
  from jsonb_array_elements(v_anomalies) as a
  where a->>'severity' = 'bloquant';
  if v_blocking > 0 then
    raise exception 'Fichier refusé : % anomalie(s) bloquante(s). Première : %',
      v_blocking,
      (select a->>'message' from jsonb_array_elements(v_anomalies) as a
       where a->>'severity' = 'bloquant' limit 1);
  end if;

  -- Le magasin est obligatoire pour les deux exports de factures, interdit
  -- pour le journal, qui est multi-magasins, et pour le catalogue.
  v_store := nullif(p_payload->>'store_id', '')::uuid;
  if v_kind in ('liste_factures', 'lignes_factures') then
    if v_store is null then
      raise exception 'Le magasin est obligatoire pour un export de factures.';
    end if;
    select skara_invoice_prefix into v_prefix from public.stores
    where id = v_store and organization_id = v_org;
    if not found then
      raise exception 'Magasin inconnu dans cette organisation.'
        using errcode = '42501';
    end if;
    select coalesce(array_agg(value), '{}')::text[] into v_payload_prefixes
    from jsonb_array_elements_text(coalesce(p_payload->'prefixes', '[]'::jsonb));

    if v_prefix is not null and array_length(v_payload_prefixes, 1) > 0
       and not (v_payload_prefixes <@ array[v_prefix]) then
      raise exception
        'Ce fichier porte le préfixe % alors que le magasin choisi utilise % : import refusé.',
        array_to_string(v_payload_prefixes, ', '), v_prefix;
    end if;
    if v_prefix is null then
      v_anomalies := v_anomalies || jsonb_build_array(jsonb_build_object(
        'kind', 'prefixe_magasin_non_configure',
        'severity', 'info',
        'message', 'Aucun préfixe de numérotation n''est configuré sur ce magasin : le contrôle d''étiquetage ne peut pas être fait.'));
    end if;
  else
    v_store := null;
  end if;

  -- Fichier déjà importé : on ne réécrit rien et on le dit.
  select * into v_existing from public.skara_imports
  where organization_id = v_org and content_hash = v_hash;
  if found then
    return jsonb_build_object(
      'import_id', v_existing.id,
      'already_imported', true,
      'kind', v_existing.kind,
      'imported_at', v_existing.imported_at,
      'rows_received', v_existing.rows_received,
      'created', 0,
      'updated', 0);
  end if;

  insert into public.skara_imports (
    organization_id, kind, store_id, file_name, content_hash,
    period_start, period_end, rows_received, footer_totals, computed_totals,
    prefixes, imported_by)
  values (
    v_org, v_kind, v_store,
    coalesce(nullif(p_payload->>'file_name', ''), 'sans-nom'),
    v_hash,
    nullif(p_payload->'period'->>'start', '')::date,
    nullif(p_payload->'period'->>'end', '')::date,
    v_received,
    p_payload->'footer',
    p_payload->'computed',
    coalesce((select array_agg(value)::text[]
              from jsonb_array_elements_text(coalesce(p_payload->'prefixes', '[]'::jsonb))),
             '{}'),
    v_profile)
  returning id into v_import;

  if v_kind = 'liste_factures' then
    v_counts := app.skara_write_invoices(v_org, v_import, v_store, v_rows);
  elsif v_kind = 'lignes_factures' then
    v_counts := app.skara_write_invoice_lines(v_org, v_import, v_store, v_rows);
  elsif v_kind = 'catalogue' then
    v_counts := app.skara_write_articles(v_org, v_import, v_rows);
  else
    v_counts := app.skara_write_journal(v_org, v_import, v_rows);
  end if;

  insert into public.skara_import_anomalies (
    organization_id, import_id, kind, severity, message, payload)
  select v_org, v_import,
         coalesce(a->>'kind', 'inconnue'),
         coalesce(a->>'severity', 'info'),
         coalesce(a->>'message', ''),
         a->'payload'
  from jsonb_array_elements(v_anomalies) as a;

  update public.skara_imports
  set rows_created = (v_counts->>'created')::integer,
      rows_updated = (v_counts->>'updated')::integer
  where id = v_import;

  perform app.log_activity(
    v_org, 'Import Skara',
    v_kind || ' : ' || v_received::text || ' ligne(s) lue(s), ' ||
    (v_counts->>'created') || ' créée(s), ' || (v_counts->>'updated') ||
    ' mise(s) à jour.');

  return jsonb_build_object(
    'import_id', v_import,
    'already_imported', false,
    'kind', v_kind,
    'rows_received', v_received,
    'created', (v_counts->>'created')::integer,
    'updated', (v_counts->>'updated')::integer,
    'anomalies', jsonb_array_length(v_anomalies));
end;
$$;

-- ===========================================================================
-- 11. Lecture des imports
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
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

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
      order by i.imported_at desc
      limit v_limit
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.get_skara_import(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.skara_imports%rowtype;
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

  select * into v_row from public.skara_imports where id = p_id;
  if not found then
    raise exception 'Import introuvable.';
  end if;
  if v_row.organization_id <> v_org then
    raise exception 'Accès refusé : cet import appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'file_name', v_row.file_name,
    'store_name', (select s.name from public.stores s where s.id = v_row.store_id),
    'period_start', v_row.period_start,
    'period_end', v_row.period_end,
    'rows_received', v_row.rows_received,
    'rows_created', v_row.rows_created,
    'rows_updated', v_row.rows_updated,
    'footer_totals', v_row.footer_totals,
    'computed_totals', v_row.computed_totals,
    'prefixes', v_row.prefixes,
    'imported_at', v_row.imported_at,
    'anomalies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind, 'severity', a.severity,
               'message', a.message, 'payload', a.payload)
             order by a.severity, a.created_at)
      from public.skara_import_anomalies a where a.import_id = v_row.id), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 12. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.import_skara_file(jsonb)',
    'public.list_skara_imports(integer)',
    'public.get_skara_import(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
