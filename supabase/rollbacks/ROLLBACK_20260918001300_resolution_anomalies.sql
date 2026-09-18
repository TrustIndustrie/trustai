-- ============================================================================
-- TRUST AI — RETOUR ARRIÈRE de la migration 13 (résolution des anomalies)
--
-- Rangé dans `supabase/rollbacks/` et NON dans `supabase/migrations/` : tout
-- outil parcourant le dossier des migrations l'exécuterait sinon
-- automatiquement. À lancer UNIQUEMENT à la demande, dans le SQL Editor.
-- ============================================================================
--
--  ⚠️  AVERTISSEMENT — À LIRE AVANT TOUTE EXÉCUTION  ⚠️
--
--  Ce script retire ce que la migration 13 a ajouté :
--     * l'HISTORIQUE des décisions (`logistics_anomaly_decisions`) — il est
--       SUPPRIMÉ, avec les motifs et les auteurs des décisions ;
--     * les colonnes `origin`, `resolution`, `resolved_row_hash` et
--       `resolved_read_id` de `logistics_anomalies`. Les anomalies déjà
--       résolues GARDENT `resolved_at`, `resolved_by` et `resolution_note` :
--       aucune anomalie ne se rouvre, mais on ne saura plus si la fermeture
--       était humaine ou automatique ;
--     * les fonctions resolve_/reopen_/report_/get_logistics_anomaly et les
--       fonctions internes app.close_sync_anomalies, app.line_row_hash ;
--     * la synchronisation et le détail de ligne reprennent leur version des
--       migrations 11 et 10 : plus aucune fermeture automatique.
--
--  Contrôle à exécuter AVANT (nombre de décisions qui seront perdues) :
--
--     select count(*) as decisions_perdues
--     from public.logistics_anomaly_decisions;
-- ============================================================================

begin;

-- 1. Fonctions propres à la migration 13.
drop function if exists public.resolve_logistics_anomaly(uuid, text, text);
drop function if exists public.reopen_logistics_anomaly(uuid, text);
drop function if exists public.report_logistics_anomaly(uuid, text, text);
drop function if exists public.get_logistics_anomaly(uuid);
drop function if exists app.close_sync_anomalies(uuid, uuid, uuid, text[], text);
drop function if exists app.line_row_hash(jsonb);

-- 2. Historique des décisions (déclencheurs compris).
drop table if exists public.logistics_anomaly_decisions;

-- 3. Colonnes et contraintes ajoutées sur les anomalies.
alter table public.logistics_anomalies
  drop constraint if exists logistics_anomalies_resolution_coherence,
  drop constraint if exists logistics_anomalies_resolution_check,
  drop constraint if exists logistics_anomalies_origin_check;
drop index if exists public.logistics_anomalies_line_type_idx;
alter table public.logistics_anomalies
  drop column if exists resolved_read_id,
  drop column if exists resolved_row_hash,
  drop column if exists resolution,
  drop column if exists origin;

-- 4. Synchronisation : version de la migration 11 (sans cycle de vie des
--    anomalies), reproduite à l'identique.
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

-- 5. Détail d'une ligne : version de la migration 10.
create or replace function public.get_logistics_line(p_line_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_line public.logistics_lines%rowtype;
begin
  if not (app.has_permission('gerer_livraisons') or app.has_permission('gerer_logistique')) then
    raise exception 'Votre rôle ne permet pas de consulter les lignes logistiques.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();

  select * into v_line from public.logistics_lines where id = p_line_id;
  if not found then
    raise exception 'Ligne logistique introuvable.';
  end if;
  if v_line.organization_id <> v_org then
    raise exception 'Accès refusé : cette ligne appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'line', to_jsonb(v_line),
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.occurred_on, e.recorded_at)
      from public.logistics_line_events e
      where e.logistics_line_id = p_line_id), '[]'::jsonb),
    'anomalies', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.detected_at desc)
      from public.logistics_anomalies a
      where a.logistics_line_id = p_line_id), '[]'::jsonb));
end;
$$;

-- 6. Droits d'exécution inchangés pour les fonctions rétablies.
do $$
declare f text;
begin
  foreach f in array array[
    'public.sync_recap_rows(uuid, jsonb, text)',
    'public.get_logistics_line(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
