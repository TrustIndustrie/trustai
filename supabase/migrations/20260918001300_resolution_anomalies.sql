-- ============================================================================
-- TRUST AI — Migration 13 : RÉSOLUTION DES ANOMALIES
-- ----------------------------------------------------------------------------
-- Avant cette migration, une anomalie ne se fermait JAMAIS : aucune fonction
-- n'écrivait `resolved_at`, et les tables sont verrouillées. Avec la
-- migration 12, une anomalie bloquante ouverte interdit l'affectation : sans
-- parcours de résolution, la ligne restait inaffectable pour toujours.
--
-- Deux familles d'anomalies, distinguées par `origin` :
--
--   * `synchronisation` — RECALCULÉES depuis le fichier à chaque lecture. La
--     synchronisation les crée, met à jour leur message, et les FERME
--     AUTOMATIQUEMENT quand la cause a réellement disparu du fichier (le
--     parseur ne produit plus ce type pour cette ligne, ou la ligne absente
--     est revenue). Un humain peut aussi les trancher ; sa décision tient tant
--     que le contenu de la ligne source ne change pas (empreinte du raw_row).
--
--   * `manuelle` — SIGNALÉES par un humain. La synchronisation ne les touche
--     jamais : seule une décision humaine les ferme.
--
-- Chaque décision (humaine ou automatique) est tracée dans
-- `logistics_anomaly_decisions`, table en AJOUT SEUL : qui, quand, quoi,
-- pourquoi, et l'état précédent.
--
-- Permission : `valider_decision` (responsable logistique, direction,
-- administrateur). Le rôle « logistique » consulte mais ne tranche pas.
--
-- Rejouable et transactionnelle, comme les migrations 9 à 12.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Colonnes : origine, décision, empreinte du contenu au moment de décider
-- ===========================================================================

alter table public.logistics_anomalies
  add column if not exists origin text not null default 'synchronisation';
alter table public.logistics_anomalies
  add column if not exists resolution text;
alter table public.logistics_anomalies
  add column if not exists resolved_row_hash text;
alter table public.logistics_anomalies
  add column if not exists resolved_read_id uuid references public.recap_reads(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'logistics_anomalies_origin_check') then
    alter table public.logistics_anomalies
      add constraint logistics_anomalies_origin_check
      check (origin in ('synchronisation', 'manuelle'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'logistics_anomalies_resolution_check') then
    alter table public.logistics_anomalies
      add constraint logistics_anomalies_resolution_check
      check (resolution is null
             or resolution in ('traitee', 'ignoree', 'disparue'));
  end if;
  -- Une anomalie résolue porte une résolution, et réciproquement.
  if not exists (select 1 from pg_constraint
                 where conname = 'logistics_anomalies_resolution_coherence') then
    alter table public.logistics_anomalies
      add constraint logistics_anomalies_resolution_coherence
      check ((resolved_at is null) = (resolution is null));
  end if;
end $$;

create index if not exists logistics_anomalies_line_type_idx
  on public.logistics_anomalies (logistics_line_id, type)
  where logistics_line_id is not null;

-- ===========================================================================
-- 2. Historique des décisions (ajout seul)
-- ===========================================================================

create table if not exists public.logistics_anomaly_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  anomaly_id uuid not null references public.logistics_anomalies(id) on delete cascade,
  logistics_line_id uuid references public.logistics_lines(id) on delete cascade,
  action text not null
    check (action in ('resolution', 'reouverture', 'fermeture_automatique', 'signalement')),
  resolution text
    check (resolution is null or resolution in ('traitee', 'ignoree', 'disparue')),
  note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz not null default now(),
  recap_read_id uuid references public.recap_reads(id) on delete set null,
  previous_state jsonb
);
create index if not exists logistics_anomaly_decisions_anomaly_idx
  on public.logistics_anomaly_decisions (anomaly_id, decided_at);
create index if not exists logistics_anomaly_decisions_line_idx
  on public.logistics_anomaly_decisions (logistics_line_id, decided_at);

-- Verrouillage identique aux 13 tables du socle : aucun accès direct.
do $$
begin
  execute 'alter table public.logistics_anomaly_decisions enable row level security';
  execute 'revoke all on public.logistics_anomaly_decisions from anon';
  execute 'revoke all on public.logistics_anomaly_decisions from authenticated';
  execute 'drop policy if exists logistics_anomaly_decisions_no_direct_access on public.logistics_anomaly_decisions';
  execute 'create policy logistics_anomaly_decisions_no_direct_access
             on public.logistics_anomaly_decisions for all to authenticated
             using (false) with check (false)';
  -- Ajout seul : une décision ne se modifie pas, on en prend une nouvelle.
  execute 'drop trigger if exists append_only_guard on public.logistics_anomaly_decisions';
  execute 'create trigger append_only_guard
             before update or delete on public.logistics_anomaly_decisions
             for each row execute function app.forbid_update_delete()';
  -- Cohérence interorganisation (déclencheur centralisé de la migration 9).
  execute 'drop trigger if exists same_org_guard on public.logistics_anomaly_decisions';
  execute $t$create trigger same_org_guard
             before insert or update on public.logistics_anomaly_decisions
             for each row execute function app.assert_same_org(
               'logistics_line_id', 'logistics_line',
               'decided_by', 'profile',
               'recap_read_id', 'recap_read')$t$;
end $$;

-- ===========================================================================
-- 3. Fonction interne : empreinte du contenu source d'une ligne
-- ===========================================================================

create or replace function app.line_row_hash(p_raw jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(p_raw::text, ''));
$$;
revoke all on function app.line_row_hash(jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 4. RPC : trancher, rouvrir, signaler
-- ===========================================================================

create or replace function public.resolve_logistics_anomaly(
  p_anomaly_id uuid,
  p_resolution text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- MIGRATION 13 : décision humaine sur une anomalie.
declare
  v_profile uuid;
  v_org uuid;
  v_anomaly public.logistics_anomalies%rowtype;
  v_line public.logistics_lines%rowtype;
begin
  v_profile := app.require_permission('valider_decision');
  v_org := app.current_org_id();

  if p_resolution not in ('traitee', 'ignoree') then
    raise exception 'Décision inconnue : « % ». Attendu : traitee ou ignoree.', p_resolution;
  end if;
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Une décision doit être motivée (note d''au moins 3 caractères).';
  end if;

  select * into v_anomaly from public.logistics_anomalies
  where id = p_anomaly_id for update;
  if not found then
    raise exception 'Anomalie introuvable.';
  end if;
  if v_anomaly.organization_id <> v_org then
    raise exception 'Accès refusé : cette anomalie appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_anomaly.resolved_at is not null then
    raise exception 'Anomalie déjà résolue le % (%).',
      v_anomaly.resolved_at::date, v_anomaly.resolution;
  end if;

  if v_anomaly.logistics_line_id is not null then
    select * into v_line from public.logistics_lines
    where id = v_anomaly.logistics_line_id;
  end if;

  insert into public.logistics_anomaly_decisions (
    organization_id, anomaly_id, logistics_line_id, action, resolution,
    note, decided_by, previous_state)
  values (v_org, v_anomaly.id, v_anomaly.logistics_line_id, 'resolution',
          p_resolution, trim(p_note), v_profile,
          jsonb_build_object('severity', v_anomaly.severity,
                             'message', v_anomaly.message,
                             'origin', v_anomaly.origin));

  update public.logistics_anomalies
  set resolved_at = clock_timestamp(),
      resolved_by = v_profile,
      resolution = p_resolution,
      resolution_note = trim(p_note),
      -- Empreinte du contenu au moment de la décision : la synchronisation
      -- ne recrée pas cette anomalie tant que la ligne source est inchangée.
      resolved_row_hash = case when v_line.id is not null
                               then app.line_row_hash(v_line.raw_row) end
  where id = v_anomaly.id;

  perform app.log_activity(
    v_org, 'Anomalie tranchée',
    coalesce(v_line.designation, v_anomaly.type) || ' — ' || v_anomaly.type ||
    ' : ' || p_resolution || ' (' || trim(p_note) || ').');

  return public.get_logistics_anomaly(v_anomaly.id);
end;
$$;

create or replace function public.reopen_logistics_anomaly(
  p_anomaly_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- MIGRATION 13 : réouverture d'une anomalie résolue (humaine ou automatique).
declare
  v_profile uuid;
  v_org uuid;
  v_anomaly public.logistics_anomalies%rowtype;
begin
  v_profile := app.require_permission('valider_decision');
  v_org := app.current_org_id();

  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Une réouverture doit être motivée (note d''au moins 3 caractères).';
  end if;

  select * into v_anomaly from public.logistics_anomalies
  where id = p_anomaly_id for update;
  if not found then
    raise exception 'Anomalie introuvable.';
  end if;
  if v_anomaly.organization_id <> v_org then
    raise exception 'Accès refusé : cette anomalie appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_anomaly.resolved_at is null then
    raise exception 'Cette anomalie est déjà ouverte.';
  end if;

  insert into public.logistics_anomaly_decisions (
    organization_id, anomaly_id, logistics_line_id, action, resolution,
    note, decided_by, previous_state)
  values (v_org, v_anomaly.id, v_anomaly.logistics_line_id, 'reouverture', null,
          trim(p_note), v_profile,
          jsonb_build_object('resolution', v_anomaly.resolution,
                             'resolved_at', v_anomaly.resolved_at,
                             'resolved_by', v_anomaly.resolved_by,
                             'resolution_note', v_anomaly.resolution_note));

  update public.logistics_anomalies
  set resolved_at = null, resolved_by = null, resolution = null,
      resolution_note = null, resolved_row_hash = null, resolved_read_id = null
  where id = v_anomaly.id;

  perform app.log_activity(
    v_org, 'Anomalie rouverte', v_anomaly.type || ' : ' || trim(p_note));

  return public.get_logistics_anomaly(v_anomaly.id);
end;
$$;

create or replace function public.report_logistics_anomaly(
  p_line_id uuid,
  p_severity text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- MIGRATION 13 : anomalie SIGNALÉE par un humain (origin = manuelle).
-- La synchronisation ne la fermera jamais.
declare
  v_profile uuid;
  v_org uuid;
  v_line public.logistics_lines%rowtype;
  v_id uuid;
begin
  v_profile := app.require_permission('valider_decision');
  v_org := app.current_org_id();

  if p_severity not in ('info', 'avertissement', 'bloquant') then
    raise exception 'Gravité inconnue : « % ».', p_severity;
  end if;
  if length(trim(coalesce(p_message, ''))) < 3 then
    raise exception 'Un signalement doit être décrit (au moins 3 caractères).';
  end if;

  select * into v_line from public.logistics_lines where id = p_line_id;
  if not found then
    raise exception 'Ligne logistique introuvable.';
  end if;
  if v_line.organization_id <> v_org then
    raise exception 'Accès refusé : cette ligne appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  insert into public.logistics_anomalies (
    organization_id, logistics_line_id, type, severity, message, origin)
  values (v_org, p_line_id, 'signalement_manuel', p_severity, trim(p_message), 'manuelle')
  returning id into v_id;

  insert into public.logistics_anomaly_decisions (
    organization_id, anomaly_id, logistics_line_id, action, note, decided_by)
  values (v_org, v_id, p_line_id, 'signalement', trim(p_message), v_profile);

  perform app.log_activity(
    v_org, 'Anomalie signalée',
    v_line.designation || ' — ' || p_severity || ' : ' || trim(p_message));

  return public.get_logistics_anomaly(v_id);
end;
$$;

-- Lecture d'une anomalie avec son historique de décisions.
create or replace function public.get_logistics_anomaly(p_anomaly_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_anomaly public.logistics_anomalies%rowtype;
begin
  if not (app.has_permission('gerer_livraisons') or app.has_permission('gerer_logistique')) then
    raise exception 'Votre rôle ne permet pas de consulter les anomalies.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();
  select * into v_anomaly from public.logistics_anomalies where id = p_anomaly_id;
  if not found then
    raise exception 'Anomalie introuvable.';
  end if;
  if v_anomaly.organization_id <> v_org then
    raise exception 'Accès refusé : cette anomalie appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  return to_jsonb(v_anomaly) || jsonb_build_object(
    'decisions', coalesce((
      select jsonb_agg(
        (to_jsonb(d) - 'organization_id')
          || jsonb_build_object('decided_by_label', p.display_name)
        order by d.decided_at)
      from public.logistics_anomaly_decisions d
      left join public.profiles p on p.id = d.decided_by
      where d.anomaly_id = p_anomaly_id), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 5. Détail d'une ligne : les anomalies portent maintenant leurs décisions
-- ===========================================================================

create or replace function public.get_logistics_line(p_line_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
-- MIGRATION 13 : chaque anomalie embarque son historique de décisions.
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
      select jsonb_agg(
        to_jsonb(a)
          || jsonb_build_object(
               'resolved_by_label', rp.display_name,
               'decisions', coalesce((
                 select jsonb_agg(
                   (to_jsonb(d) - 'organization_id')
                     || jsonb_build_object('decided_by_label', dp.display_name)
                   order by d.decided_at)
                 from public.logistics_anomaly_decisions d
                 left join public.profiles dp on dp.id = d.decided_by
                 where d.anomaly_id = a.id), '[]'::jsonb))
        order by (a.resolved_at is null) desc, a.detected_at desc)
      from public.logistics_anomalies a
      left join public.profiles rp on rp.id = a.resolved_by
      where a.logistics_line_id = p_line_id), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 6. Synchronisation : création, mise à jour et FERMETURE AUTOMATIQUE
-- ===========================================================================

-- Fermeture automatique : réservée à la synchronisation (schéma app).
create or replace function app.close_sync_anomalies(
  p_org uuid,
  p_line_id uuid,
  p_read_id uuid,
  p_types text[],
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.logistics_anomalies%rowtype;
  v_n integer := 0;
begin
  for v_a in
    select * from public.logistics_anomalies
    where logistics_line_id = p_line_id
      and resolved_at is null
      and origin = 'synchronisation'
      and type = any(p_types)
    for update
  loop
    insert into public.logistics_anomaly_decisions (
      organization_id, anomaly_id, logistics_line_id, action, resolution,
      note, decided_by, recap_read_id, previous_state)
    values (p_org, v_a.id, p_line_id, 'fermeture_automatique', 'disparue',
            p_reason, null, p_read_id,
            jsonb_build_object('severity', v_a.severity, 'message', v_a.message));

    update public.logistics_anomalies
    set resolved_at = clock_timestamp(),
        resolved_by = null,
        resolution = 'disparue',
        resolution_note = p_reason,
        resolved_read_id = p_read_id
    where id = v_a.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function app.close_sync_anomalies(uuid, uuid, uuid, text[], text)
  from public, anon, authenticated;


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
-- MIGRATION 13 : cycle de vie des anomalies de synchronisation.
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
  v_closed integer := 0;
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
  v_types text[];
  v_to_close text[];
  v_hash text;
  v_open public.logistics_anomalies%rowtype;
  v_n integer;
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

      -- La ligne est revenue dans le fichier : l'anomalie « absente » de la
      -- synchronisation se ferme d'elle-même, la cause a disparu.
      if v_line.missing_since is not null then
        v_closed := v_closed + app.close_sync_anomalies(
          v_org, v_id, v_read, array['ligne_absente_du_fichier'],
          'La ligne est réapparue dans le récapitulatif.');
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

    -- ------------------------------------------------------------------
    -- Anomalies RECALCULÉES depuis le fichier (origin = synchronisation).
    -- ------------------------------------------------------------------
    v_hash := app.line_row_hash(v_row->'raw_row');
    v_types := array[]::text[];

    for v_ev in select * from jsonb_array_elements(coalesce(v_row->'anomalies', '[]'::jsonb))
    loop
      v_types := v_types || (v_ev->>'type');

      select * into v_open from public.logistics_anomalies
      where logistics_line_id = v_id
        and type = v_ev->>'type'
        and resolved_at is null
      limit 1;

      if found then
        -- Déjà ouverte : le fichier reste la source de vérité de son libellé.
        if v_open.origin = 'synchronisation'
           and (v_open.severity is distinct from coalesce(nullif(v_ev->>'severity', ''), 'avertissement')
                or v_open.message is distinct from v_ev->>'message') then
          update public.logistics_anomalies
          set severity = coalesce(nullif(v_ev->>'severity', ''), 'avertissement'),
              message = v_ev->>'message'
          where id = v_open.id;
        end if;
        continue;
      end if;

      -- Tranchée par un humain sur ce MÊME contenu : sa décision tient.
      if exists (
        select 1 from public.logistics_anomalies
        where logistics_line_id = v_id
          and type = v_ev->>'type'
          and origin = 'synchronisation'
          and resolution in ('traitee', 'ignoree')
          and resolved_row_hash = v_hash
      ) then
        continue;
      end if;

      insert into public.logistics_anomalies (
        organization_id, logistics_line_id, type, severity, message, origin)
      values (v_org, v_id, v_ev->>'type',
              coalesce(nullif(v_ev->>'severity', ''), 'avertissement'),
              v_ev->>'message', 'synchronisation');
      v_anomalies := v_anomalies + 1;
    end loop;

    -- Cause disparue : les anomalies de synchronisation encore ouvertes dont
    -- le type n'est plus produit par le parseur se ferment automatiquement.
    -- « ligne_absente_du_fichier » est gérée plus haut (retour de la ligne).
    -- Les anomalies MANUELLES ne sont jamais touchées.
    select coalesce(array_agg(a.type), array[]::text[]) into v_to_close
    from (
      select distinct type from public.logistics_anomalies
      where logistics_line_id = v_id
        and resolved_at is null
        and origin = 'synchronisation'
        and type <> 'ligne_absente_du_fichier'
        and not (type = any(v_types))
    ) a;
    if array_length(v_to_close, 1) > 0 then
      v_closed := v_closed + app.close_sync_anomalies(
        v_org, v_id, v_read, v_to_close,
        'La cause n''apparaît plus dans le récapitulatif.');
    end if;
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
      organization_id, logistics_line_id, type, severity, message, origin)
    select v_org, l.id, 'ligne_absente_du_fichier', 'avertissement',
           'Cette ligne n''apparaît plus dans le récapitulatif. Elle est conservée : '
           || 'vérifiez s''il s''agit d''une suppression volontaire.',
           'synchronisation'
    from public.logistics_lines l
    where l.source_id = p_source_id
      and l.missing_since is not null
      and l.stage not in ('sortie', 'annulee')
      and not exists (
        select 1 from public.logistics_anomalies a
        where a.logistics_line_id = l.id
          and a.type = 'ligne_absente_du_fichier'
          and a.resolved_at is null);
    get diagnostics v_n = row_count;
    v_anomalies := v_anomalies + v_n;
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
        'anomalies_closed', v_closed,
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
    v_anomalies::text || ' anomalie(s), ' || v_closed::text || ' fermée(s), ' ||
    v_missing::text || ' absente(s).');

  return jsonb_build_object(
    'read_id', v_read,
    'rows_read', jsonb_array_length(p_rows),
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'ignored', v_ignored,
    'anomalies', v_anomalies,
    'anomalies_closed', v_closed,
    'missing', v_missing);
end;
$$;

-- ===========================================================================
-- 7. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.resolve_logistics_anomaly(uuid, text, text)',
    'public.reopen_logistics_anomaly(uuid, text)',
    'public.report_logistics_anomaly(uuid, text, text)',
    'public.get_logistics_anomaly(uuid)',
    'public.get_logistics_line(uuid)',
    'public.sync_recap_rows(uuid, jsonb, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
