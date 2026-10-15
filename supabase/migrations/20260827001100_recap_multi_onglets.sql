-- ============================================================================
-- TRUST AI — Migration 11 : RÉCAPITULATIF, PLUSIEURS ONGLETS ET TROIS SORTIES
-- ----------------------------------------------------------------------------
-- Suite de la migration 10, écrite après avoir analysé le fichier RÉEL de
-- Trust Industrie (1 107 lignes sur deux onglets). Elle acte quatre faits que
-- la migration 10 ne savait pas encore :
--
--  1. LE FICHIER EST ORGANISÉ PAR ANNÉE. « INTERNET » couvre l'année en
--     cours, « SUIVIS 2025 » l'année précédente, et un nouvel onglet
--     apparaîtra en janvier. Une seule source par organisation ne suffit
--     donc plus : l'identité d'une source devient (classeur, onglet).
--
--  2. IL Y A TROIS FAÇONS DE SERVIR UN CLIENT, pas une : servi par Paris,
--     livré depuis Aubagne, retiré à Aubagne. Une ligne close par l'un des
--     trois n'est plus disponible ; n'en suivre qu'une reviendrait à
--     annoncer de la marchandise déjà partie.
--
--  3. L'AFFRÈTEMENT matérialise le transfert Argenteuil → Aubagne (70
--     numéros distincts). On le conserve pour pouvoir retrouver un lot.
--
--  4. LES TRANSPORTEURS CHANGENT D'UNE ANNÉE SUR L'AUTRE (OMAR, GEODIS,
--     GUISNEL, DEFITRANS, COCOLIS…). Leur liste vit donc dans la
--     CONFIGURATION, éditable sans toucher au code.
--
-- TRUST AI reste en LECTURE SEULE sur le Google Sheet.
-- Rejouable et transactionnelle, comme les migrations 9 et 10.
-- ============================================================================

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logistics_lines'
      and column_name = 'exit_channel'
  ) then
    raise notice 'TRUST AI : migration 11 déjà appliquée — réexécution sans effet.';
  end if;
end $$;

-- ===========================================================================
-- 1. Les trois chemins de sortie et l'affrètement
-- ===========================================================================

alter table public.logistics_lines
  add column if not exists exit_channel text,
  add column if not exists exit_at date,
  add column if not exists freight_ref text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'logistics_lines_exit_channel_check'
  ) then
    alter table public.logistics_lines
      add constraint logistics_lines_exit_channel_check
      check (exit_channel is null
             or exit_channel in ('paris', 'livraison_aubagne', 'retrait_aubagne'));
  end if;
end $$;

-- Retrouver rapidement un lot affrété (« E243 ») ou les sorties d'un canal.
create index if not exists logistics_lines_freight_idx
  on public.logistics_lines (organization_id, freight_ref)
  where freight_ref is not null;
create index if not exists logistics_lines_exit_idx
  on public.logistics_lines (organization_id, exit_channel, exit_at)
  where exit_channel is not null;

-- ===========================================================================
-- 2. Plusieurs sources par organisation (un onglet = une source)
-- ===========================================================================

alter table public.recap_sources
  add column if not exists client_carriers text[] not null default '{}'::text[];

comment on column public.recap_sources.client_carriers is
  'Transporteurs qui livrent le client depuis Paris. Sert à déterminer la '
  'destination quand rien d''autre ne la donne. Éditable dans l''application : '
  'la liste change d''une année sur l''autre.';

-- La migration 9 rendait le LIBELLÉ unique par organisation. C'était juste
-- tant qu'il n'existait qu'une source ; ça interdit maintenant deux onglets
-- portant le même nom d'affichage. Le libellé redevient purement décoratif.
alter table public.recap_sources
  drop constraint if exists recap_sources_organization_id_label_key;

-- L'identité d'une source, c'est le couple (classeur, onglet) : deux onglets
-- du même fichier sont deux sources, et déclarer deux fois le même onglet
-- doit mettre à jour la source existante, jamais en créer une seconde.
create unique index if not exists recap_sources_sheet_key
  on public.recap_sources (organization_id, spreadsheet_id, sheet_name);

-- ===========================================================================
-- 3. Lecture de la configuration
-- ---------------------------------------------------------------------------
-- `get_recap_source()` sans argument ne veut plus rien dire dès qu'il y a
-- plusieurs onglets : elle est remplacée par une liste explicite.
-- ===========================================================================

drop function if exists public.get_recap_source();

create or replace function public.list_recap_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not (app.has_permission('importer_recap') or app.has_permission('gerer_livraisons')) then
    raise exception 'Votre rôle ne permet pas de consulter la configuration du récapitulatif.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();

  return coalesce((
    select jsonb_agg(to_jsonb(s) order by s.created_at)
    from (
      select
        src.id, src.kind, src.label, src.spreadsheet_id, src.sheet_name,
        src.header_row, src.id_column, src.column_mapping, src.client_carriers,
        src.active, src.created_at, src.last_read_at, src.last_read_status,
        (select count(*) from public.logistics_lines l
         where l.source_id = src.id)::integer as lines_count,
        (
          select to_jsonb(r) from (
            select id, trigger_type, started_at, finished_at, rows_read,
                   rows_created, rows_updated, rows_ignored, errors_count, report
            from public.recap_reads
            where source_id = src.id
            order by started_at desc
            limit 1
          ) r
        ) as last_read
      from public.recap_sources src
      where src.organization_id = v_org
    ) s), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- 4. Enregistrement d'une source
-- ===========================================================================

create or replace function public.upsert_recap_source(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_label text;
  v_sheet text;
  v_book text;
  v_carriers text[];
begin
  perform app.require_permission('importer_recap');
  v_org := app.current_org_id();

  v_book := coalesce(nullif(btrim(p_payload->>'spreadsheet_id'), ''), '');
  v_sheet := coalesce(nullif(btrim(p_payload->>'sheet_name'), ''), '');
  v_label := coalesce(nullif(btrim(p_payload->>'label'), ''), v_sheet, 'Récapitulatif');

  if v_book = '' then
    raise exception 'L''identifiant du Google Sheet est obligatoire.';
  end if;
  if v_sheet = '' then
    raise exception 'Le nom de l''onglet est obligatoire.';
  end if;
  if coalesce((p_payload->>'header_row')::integer, 1) < 1 then
    raise exception 'La ligne d''en-têtes doit être un numéro de ligne (1 ou plus).';
  end if;
  if jsonb_typeof(coalesce(p_payload->'column_mapping', '{}'::jsonb)) <> 'object' then
    raise exception 'Le mapping des colonnes est invalide.';
  end if;

  -- Transporteurs : on ne garde que du texte non vide, sans doublon.
  select coalesce(array_agg(distinct btrim(value)) filter (where btrim(value) <> ''), '{}')
  into v_carriers
  from jsonb_array_elements_text(
    case when jsonb_typeof(p_payload->'client_carriers') = 'array'
         then p_payload->'client_carriers' else '[]'::jsonb end) as value;

  -- Identité : l'id explicite s'il est fourni, sinon le couple (classeur,
  -- onglet). Le libellé n'identifie plus rien : il est purement décoratif.
  v_id := nullif(btrim(coalesce(p_payload->>'id', '')), '')::uuid;
  if v_id is not null then
    perform 1 from public.recap_sources
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Source de récapitulatif introuvable.' using errcode = '42501';
    end if;
  else
    select id into v_id from public.recap_sources
    where organization_id = v_org and spreadsheet_id = v_book and sheet_name = v_sheet;
  end if;

  if v_id is null then
    insert into public.recap_sources (
      organization_id, kind, label, spreadsheet_id, sheet_name,
      header_row, id_column, column_mapping, client_carriers)
    values (
      v_org, coalesce(nullif(p_payload->>'kind', ''), 'google_sheet'), v_label,
      v_book, v_sheet,
      coalesce((p_payload->>'header_row')::integer, 1),
      nullif(btrim(coalesce(p_payload->>'id_column', '')), ''),
      coalesce(p_payload->'column_mapping', '{}'::jsonb),
      v_carriers)
    returning id into v_id;
  else
    update public.recap_sources
    set label = v_label,
        spreadsheet_id = v_book,
        sheet_name = v_sheet,
        header_row = coalesce((p_payload->>'header_row')::integer, header_row),
        id_column = nullif(btrim(coalesce(p_payload->>'id_column', '')), ''),
        column_mapping = coalesce(p_payload->'column_mapping', column_mapping),
        client_carriers = v_carriers,
        active = coalesce((p_payload->>'active')::boolean, true)
    where id = v_id;
  end if;

  perform app.log_activity(
    v_org, 'Récapitulatif configuré',
    v_label || ' — onglet « ' || v_sheet || ' ».');
  return v_id;
end;
$$;

-- ===========================================================================
-- 5. Mise en sommeil d'une source
-- ---------------------------------------------------------------------------
-- On ne SUPPRIME jamais une source : les lignes déjà importées perdraient
-- leur rattachement et leur historique. On la désactive.
-- ===========================================================================

create or replace function public.set_recap_source_active(
  p_source_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_source public.recap_sources%rowtype;
begin
  perform app.require_permission('importer_recap');
  v_org := app.current_org_id();

  select * into v_source from public.recap_sources where id = p_source_id;
  if not found then
    raise exception 'Source de récapitulatif introuvable.';
  end if;
  if v_source.organization_id <> v_org then
    raise exception 'Accès refusé : cette source appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  update public.recap_sources set active = coalesce(p_active, true) where id = p_source_id;
  perform app.log_activity(
    v_org,
    case when p_active then 'Récapitulatif réactivé' else 'Récapitulatif mis en sommeil' end,
    v_source.label || ' — onglet « ' || v_source.sheet_name || ' ».');
end;
$$;

-- ===========================================================================
-- 6. Import : les trois sorties et l'affrètement
-- ---------------------------------------------------------------------------
-- Seules les colonnes nouvelles changent ; toute la mécanique d'idempotence
-- de la migration 10 est conservée à l'identique.
-- ===========================================================================

create or replace function public.sync_recap_rows(
  p_source_id uuid,
  p_rows jsonb,
  p_trigger text default 'manuel'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_source public.recap_sources%rowtype;
  v_read uuid;
  v_row jsonb;
  v_line public.logistics_lines%rowtype;
  v_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_ignored integer := 0;
  v_anomalies integer := 0;
  v_missing integer := 0;
  v_seen uuid[] := array[]::uuid[];
  v_changed boolean;
  v_stage text;
  v_dest uuid;
  v_conf text;
  v_channel text;
  v_exit_at date;
  v_freight text;
  v_ev jsonb;
begin
  v_profile := app.require_permission('importer_recap');
  v_org := app.current_org_id();

  select * into v_source from public.recap_sources where id = p_source_id;
  if not found then
    raise exception 'Source de récapitulatif introuvable.';
  end if;
  if v_source.organization_id <> v_org then
    raise exception 'Accès refusé : cette source appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Lignes attendues sous forme de tableau.';
  end if;

  insert into public.recap_reads (
    organization_id, source_id, trigger_type, triggered_by_profile_id)
  values (v_org, p_source_id,
          case when p_trigger = 'automatique' then 'automatique' else 'manuel' end,
          v_profile)
  returning id into v_read;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    -- Lignes écartées par le parseur (totaux, lignes vides…).
    if coalesce((v_row->>'ignored')::boolean, false) then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    v_stage := coalesce(nullif(v_row->>'stage', ''), 'attendue');
    v_dest := nullif(v_row->>'destination_warehouse_id', '')::uuid;
    v_conf := coalesce(nullif(v_row->>'destination_confidence', ''), 'deduite');
    v_channel := nullif(v_row->>'exit_channel', '');
    v_exit_at := nullif(v_row->>'exit_at', '')::date;
    v_freight := nullif(v_row->>'freight_ref', '');

    if v_channel is not null
       and v_channel not in ('paris', 'livraison_aubagne', 'retrait_aubagne') then
      raise exception 'Chemin de sortie inconnu : %', v_channel;
    end if;

    -- 1) Identification par « ID TRUST », 2) sinon par empreinte.
    v_id := null;
    if coalesce(nullif(v_row->>'recap_row_id', ''), '') <> '' then
      select id into v_id from public.logistics_lines
      where source_id = p_source_id and recap_row_id = v_row->>'recap_row_id';
    end if;
    if v_id is null then
      select id into v_id from public.logistics_lines
      where source_id = p_source_id
        and recap_row_fingerprint = v_row->>'fingerprint'
        and (recap_row_id is null or coalesce(nullif(v_row->>'recap_row_id',''), '') = '');
    end if;

    if v_id is null then
      insert into public.logistics_lines (
        organization_id, origin, source_id, recap_row_id, recap_row_fingerprint,
        recap_date, supplier_label, supplier_reference, supplier_order_ref,
        designation, quantity, customer_label, expected_at, comments,
        stage, current_warehouse_id, destination_warehouse_id,
        destination_confidence, exit_channel, exit_at, freight_ref,
        raw_row, created_by, last_read_id)
      values (
        v_org, 'recap', p_source_id,
        nullif(v_row->>'recap_row_id', ''), v_row->>'fingerprint',
        nullif(v_row->>'recap_date', '')::date,
        nullif(v_row->>'supplier_label', ''),
        nullif(v_row->>'supplier_reference', ''),
        nullif(v_row->>'supplier_order_ref', ''),
        coalesce(nullif(v_row->>'designation', ''), 'Article sans désignation'),
        greatest(coalesce((v_row->>'quantity')::integer, 1), 1),
        nullif(v_row->>'customer_label', ''),
        nullif(v_row->>'expected_at', '')::date,
        nullif(v_row->>'comments', ''),
        v_stage,
        nullif(v_row->>'current_warehouse_id', '')::uuid,
        v_dest, v_conf, v_channel, v_exit_at, v_freight,
        v_row->'raw_row', v_profile, v_read)
      returning id into v_id;
      v_created := v_created + 1;
    else
      select * into v_line from public.logistics_lines where id = v_id;

      v_changed :=
        v_line.designation is distinct from nullif(v_row->>'designation', '')
        or v_line.quantity is distinct from (v_row->>'quantity')::integer
        or v_line.customer_label is distinct from nullif(v_row->>'customer_label', '')
        or v_line.supplier_label is distinct from nullif(v_row->>'supplier_label', '')
        or v_line.supplier_reference is distinct from nullif(v_row->>'supplier_reference', '')
        or v_line.supplier_order_ref is distinct from nullif(v_row->>'supplier_order_ref', '')
        or v_line.expected_at is distinct from nullif(v_row->>'expected_at', '')::date
        or v_line.comments is distinct from nullif(v_row->>'comments', '')
        or v_line.stage is distinct from v_stage
        or v_line.destination_warehouse_id is distinct from v_dest
        or v_line.exit_channel is distinct from v_channel
        or v_line.exit_at is distinct from v_exit_at
        or v_line.freight_ref is distinct from v_freight
        or v_line.raw_row is distinct from v_row->'raw_row';

      update public.logistics_lines
      set recap_row_id = coalesce(nullif(v_row->>'recap_row_id', ''), recap_row_id),
          recap_date = coalesce(nullif(v_row->>'recap_date', '')::date, recap_date),
          supplier_label = nullif(v_row->>'supplier_label', ''),
          supplier_reference = nullif(v_row->>'supplier_reference', ''),
          supplier_order_ref = nullif(v_row->>'supplier_order_ref', ''),
          designation = coalesce(nullif(v_row->>'designation', ''), designation),
          quantity = greatest(coalesce((v_row->>'quantity')::integer, quantity), 1),
          customer_label = nullif(v_row->>'customer_label', ''),
          expected_at = nullif(v_row->>'expected_at', '')::date,
          comments = nullif(v_row->>'comments', ''),
          -- Le suivi interne ne recule jamais : une ligne déjà sortie ou
          -- annulée dans TRUST AI n'est pas ramenée en arrière par le fichier.
          stage = case when stage in ('sortie', 'annulee') then stage else v_stage end,
          current_warehouse_id = nullif(v_row->>'current_warehouse_id', '')::uuid,
          destination_warehouse_id = v_dest,
          destination_confidence = v_conf,
          -- Une sortie déjà constatée n'est jamais effacée par une lecture
          -- ultérieure : le fichier peut être corrigé, la marchandise est
          -- partie quand même.
          exit_channel = coalesce(v_channel, exit_channel),
          exit_at = coalesce(v_exit_at, exit_at),
          freight_ref = coalesce(v_freight, freight_ref),
          raw_row = v_row->'raw_row',
          missing_since = null,
          last_read_id = v_read,
          last_seen_at = now(),
          -- clock_timestamp() : instant RÉEL de la modification. now() est figé
          -- pour toute la transaction ; deux lectures successives dans la même
          -- transaction seraient alors indiscernables.
          last_changed_at = case
            when v_changed then clock_timestamp() else last_changed_at end
      where id = v_id;

      if v_changed then
        v_updated := v_updated + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    end if;

    v_seen := v_seen || v_id;

    -- Événements logistiques : jamais deux fois le même (type + date).
    for v_ev in select * from jsonb_array_elements(coalesce(v_row->'events', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.logistics_line_events
        where logistics_line_id = v_id
          and event_type = v_ev->>'event_type'
          and occurred_on = (v_ev->>'occurred_on')::date
      ) then
        insert into public.logistics_line_events (
          organization_id, logistics_line_id, event_type, warehouse_id,
          occurred_on, quantity, source, recorded_by, notes)
        values (
          v_org, v_id, v_ev->>'event_type',
          nullif(v_ev->>'warehouse_id', '')::uuid,
          (v_ev->>'occurred_on')::date,
          nullif(v_ev->>'quantity', '')::integer,
          'recap', v_profile, nullif(v_ev->>'notes', ''));
      end if;
    end loop;

    -- Anomalies signalées par le parseur : jamais de doublon non résolu.
    for v_ev in select * from jsonb_array_elements(coalesce(v_row->'anomalies', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.logistics_anomalies
        where logistics_line_id = v_id
          and type = v_ev->>'type'
          and resolved_at is null
      ) then
        insert into public.logistics_anomalies (
          organization_id, logistics_line_id, type, severity, message)
        values (v_org, v_id, v_ev->>'type',
                coalesce(nullif(v_ev->>'severity', ''), 'avertissement'),
                v_ev->>'message');
        v_anomalies := v_anomalies + 1;
      end if;
    end loop;
  end loop;

  -- Lignes absentes du fichier : marquées, JAMAIS supprimées.
  update public.logistics_lines
  set missing_since = coalesce(missing_since, now())
  where source_id = p_source_id
    and origin = 'recap'
    and stage not in ('sortie', 'annulee')
    and not (id = any(v_seen));
  get diagnostics v_missing = row_count;

  if v_missing > 0 then
    insert into public.logistics_anomalies (
      organization_id, logistics_line_id, type, severity, message)
    select v_org, l.id, 'ligne_absente_du_fichier', 'avertissement',
           'Cette ligne n''apparaît plus dans le récapitulatif. Elle est conservée : '
           || 'vérifiez s''il s''agit d''une suppression volontaire.'
    from public.logistics_lines l
    where l.source_id = p_source_id
      and l.missing_since is not null
      and l.stage not in ('sortie', 'annulee')
      and not exists (
        select 1 from public.logistics_anomalies a
        where a.logistics_line_id = l.id
          and a.type = 'ligne_absente_du_fichier'
          and a.resolved_at is null);
  end if;

  update public.recap_reads
  set finished_at = now(),
      rows_read = jsonb_array_length(p_rows),
      rows_created = v_created,
      rows_updated = v_updated,
      rows_ignored = v_ignored,
      errors_count = v_anomalies,
      report = jsonb_build_object(
        'unchanged', v_unchanged,
        'anomalies', v_anomalies,
        'missing', v_missing)
  where id = v_read;

  update public.recap_sources
  set last_read_at = now(),
      last_read_status = 'succes'
  where id = p_source_id;

  perform app.log_activity(
    v_org, 'Récapitulatif synchronisé',
    v_source.label || ' : ' ||
    v_created::text || ' créée(s), ' || v_updated::text || ' modifiée(s), ' ||
    v_unchanged::text || ' inchangée(s), ' || v_ignored::text || ' ignorée(s), ' ||
    v_anomalies::text || ' anomalie(s), ' || v_missing::text || ' absente(s).');

  return jsonb_build_object(
    'read_id', v_read,
    'rows_read', jsonb_array_length(p_rows),
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'ignored', v_ignored,
    'anomalies', v_anomalies,
    'missing', v_missing);
end;
$$;

-- ===========================================================================
-- 7. Lecture des lignes : filtre par onglet et par chemin de sortie
-- ===========================================================================

drop function if exists public.list_logistics_lines(
  text, text, text, uuid, boolean, integer, integer);

create or replace function public.list_logistics_lines(
  p_search text default null,
  p_stage text default null,
  p_supplier text default null,
  p_warehouse_id uuid default null,
  p_only_anomalies boolean default false,
  p_limit integer default 50,
  p_offset integer default 0,
  p_source_id uuid default null,
  p_exit_channel text default null
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
      and (p_source_id is null or l.source_id = p_source_id)
      and (p_exit_channel is null or l.exit_channel = p_exit_channel)
      and (p_warehouse_id is null
           or l.destination_warehouse_id = p_warehouse_id
           or l.current_warehouse_id = p_warehouse_id)
      and (v_search is null
           or l.designation ilike '%' || v_search || '%'
           or coalesce(l.customer_label, '') ilike '%' || v_search || '%'
           or coalesce(l.supplier_reference, '') ilike '%' || v_search || '%'
           or coalesce(l.supplier_order_ref, '') ilike '%' || v_search || '%'
           or coalesce(l.freight_ref, '') ilike '%' || v_search || '%'
           or coalesce(l.recap_row_id, '') ilike '%' || v_search || '%')
  ), counted as (
    select * from filtered
    where not p_only_anomalies or open_anomalies > 0 or missing_since is not null
  ), page as (
    -- La page demandée : le tri est appliqué AVANT la découpe, sinon
    -- « page 2 » ne voudrait rien dire.
    select c.id, c.recap_row_id, c.recap_date, c.supplier_label,
           c.supplier_reference, c.supplier_order_ref, c.designation, c.quantity,
           c.customer_label, c.expected_at, c.comments, c.stage,
           c.destination_confidence, c.missing_since, c.last_seen_at,
           c.last_changed_at, c.open_anomalies,
           c.exit_channel, c.exit_at, c.freight_ref, c.source_id,
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

-- ===========================================================================
-- 8. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_recap_sources()',
    'public.upsert_recap_source(jsonb)',
    'public.set_recap_source_active(uuid, boolean)',
    'public.sync_recap_rows(uuid, jsonb, text)',
    'public.list_logistics_lines(text, text, text, uuid, boolean, integer, integer, uuid, text)',
    'public.get_logistics_line(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
