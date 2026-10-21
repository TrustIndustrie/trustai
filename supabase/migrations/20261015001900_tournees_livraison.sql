-- ============================================================================
-- TRUST AI — Migration 19 : TOURNÉES DE LIVRAISON (lot 2B)
-- ----------------------------------------------------------------------------
-- Le lot 2A a donné la date : un dossier devient livrable, un responsable
-- autorise le contact, un créneau est convenu avec le client. Reste à tenir
-- cette date, et c'est l'objet des tournées : regrouper les créneaux
-- confirmés d'une journée, au départ d'un dépôt, dans un ordre de passage.
--
-- LA RÈGLE QUI JUSTIFIE TOUT LE RESTE : on ne met pas dans la tournée du
-- mardi un client à qui on a promis le lundi. Un passage ne s'ajoute que si
-- la date de la tournée est EXACTEMENT celle du créneau retenu, et que le
-- dépôt de départ est le même. Sans ce contrôle, l'outil permettrait de
-- construire proprement une tournée qui trahit la promesse faite au client,
-- ce qui est pire que pas d'outil du tout.
--
-- Le socle avait délibérément laissé le terrain libre : il est écrit dans la
-- migration 9 qu'aucune référence vers une table de passage n'a été créée,
-- pour ne pas préjuger de sa forme.
--
-- CE QUE CETTE MIGRATION N'OUVRE PAS : les droits du rôle `livreur`, qui
-- reste sans aucune permission. Le socle liait leur ouverture à une phase
-- dédiée, avec ses propres tests de sécurité au niveau des lignes ; donner
-- un accès terrain est une décision à part, pas un effet de bord des
-- tournées. En attendant, les résultats de passage se saisissent au bureau,
-- sous `executer_livraison`, que le responsable logistique détient déjà.
--
-- Rejouable et transactionnelle.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Le garde-fou interorganisation connaît deux objets de plus
-- ===========================================================================
--
-- `app.assert_same_org` repose sur `app.org_of` : sans ces deux cas, un
-- passage pourrait rattacher une tournée de l'organisation A à un créneau de
-- l'organisation B. Une clé étrangère garantit que la ligne visée existe,
-- jamais qu'elle appartient à la même organisation.

create or replace function app.org_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_id is null then return null; end if;
  case p_kind
    when 'profile' then
      select organization_id into v_org from public.profiles where id = p_id;
    when 'store' then
      select organization_id into v_org from public.stores where id = p_id;
    when 'warehouse' then
      select organization_id into v_org from public.warehouses where id = p_id;
    when 'supplier' then
      select organization_id into v_org from public.suppliers where id = p_id;
    when 'customer' then
      select organization_id into v_org from public.customers where id = p_id;
    when 'variant' then
      -- L'organisation d'une variante est portée par son produit.
      select p.organization_id into v_org
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.id = p_id;
    when 'recap_source' then
      select organization_id into v_org from public.recap_sources where id = p_id;
    when 'recap_read' then
      select organization_id into v_org from public.recap_reads where id = p_id;
    when 'logistics_line' then
      select organization_id into v_org from public.logistics_lines where id = p_id;
    when 'delivery_job' then
      select organization_id into v_org from public.delivery_jobs where id = p_id;
    when 'document' then
      select organization_id into v_org from public.skara_documents where id = p_id;
    when 'extraction' then
      select organization_id into v_org from public.skara_document_extractions where id = p_id;
    -- Ajouts de la migration 19.
    when 'delivery_slot' then
      select organization_id into v_org from public.delivery_slots where id = p_id;
    when 'delivery_round' then
      select organization_id into v_org from public.delivery_rounds where id = p_id;
    else
      raise exception 'Type d''objet inconnu pour le contrôle d''organisation : %', p_kind;
  end case;
  return v_org;
end;
$$;

-- ===========================================================================
-- 2. La tournée
-- ===========================================================================

create table if not exists public.delivery_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  round_date date not null,
  -- Une tournée part d'UN dépôt : c'est là qu'on charge le camion.
  warehouse_id uuid not null references public.warehouses(id),
  label text not null,
  -- Le livreur affecté. Nul tant que la tournée est un brouillon : on
  -- compose d'abord, on affecte ensuite.
  driver_profile_id uuid references public.profiles(id),
  vehicle_label text,
  stage text not null default 'brouillon' check (stage in (
    'brouillon',   -- en cours de composition, rien n'est engagé
    'planifiee',   -- livreur affecté, dossiers passés à « planifié »
    'en_cours',    -- le camion est parti
    'terminee',
    'annulee'
  )),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, round_date, warehouse_id, label)
);

create index if not exists delivery_rounds_org_date_idx
  on public.delivery_rounds (organization_id, round_date);
create index if not exists delivery_rounds_driver_idx
  on public.delivery_rounds (driver_profile_id, round_date);

-- ===========================================================================
-- 3. Le passage
-- ===========================================================================

create table if not exists public.delivery_round_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  round_id uuid not null references public.delivery_rounds(id) on delete cascade,
  delivery_job_id uuid not null references public.delivery_jobs(id),
  -- Le créneau qui JUSTIFIE ce passage. Sans lui, plus rien ne relie la
  -- tournée à la promesse faite au client.
  slot_id uuid references public.delivery_slots(id),
  position integer not null check (position > 0),
  status text not null default 'prevu' check (status in (
    'prevu', 'livre', 'echec', 'reporte'
  )),
  outcome_note text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un dossier n'apparaît qu'une fois dans une tournée donnée.
create unique index if not exists delivery_round_stops_job_key
  on public.delivery_round_stops (round_id, delivery_job_id);
-- Un ordre de passage est unique dans une tournée. Un index unique n'étant
-- pas différable, la réorganisation décale d'abord toutes les positions d'un
-- millier avant de réécrire les définitives : sans ce détour, l'échange de
-- deux passages violerait l'index en cours de route.
create unique index if not exists delivery_round_stops_position_key
  on public.delivery_round_stops (round_id, position);
create index if not exists delivery_round_stops_job_idx
  on public.delivery_round_stops (delivery_job_id);

-- ===========================================================================
-- 4. Verrouillage
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array['delivery_rounds', 'delivery_round_stops']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_direct_access', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (false) with check (false)',
                   t || '_no_direct_access', t);
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                      for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

drop trigger if exists same_org_guard on public.delivery_rounds;
create trigger same_org_guard
  before insert or update on public.delivery_rounds
  for each row execute function app.assert_same_org(
    'warehouse_id', 'warehouse',
    'driver_profile_id', 'profile',
    'created_by', 'profile');

drop trigger if exists same_org_guard on public.delivery_round_stops;
create trigger same_org_guard
  before insert or update on public.delivery_round_stops
  for each row execute function app.assert_same_org(
    'round_id', 'delivery_round',
    'delivery_job_id', 'delivery_job',
    'slot_id', 'delivery_slot',
    'recorded_by', 'profile');

-- ===========================================================================
-- 5. Composer une tournée
-- ===========================================================================

create or replace function public.create_delivery_round(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_date date := nullif(p_payload->>'date', '')::date;
  v_warehouse uuid := nullif(p_payload->>'warehouse_id', '')::uuid;
  v_label text := nullif(trim(coalesce(p_payload->>'label', '')), '');
  v_id uuid;
begin
  v_profile := app.require_permission('gerer_logistique');
  v_org := app.current_org_id();

  if v_date is null then
    raise exception 'La tournée doit porter une date.' using errcode = '22023';
  end if;
  if v_date < current_date then
    raise exception 'Le % est déjà passé : une tournée ne se crée pas dans le passé.',
      to_char(v_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if v_warehouse is null then
    raise exception 'La tournée doit partir d''un dépôt.' using errcode = '22023';
  end if;
  if v_label is null then
    raise exception 'Donnez un nom à la tournée : c''est ce que le livreur lira.'
      using errcode = '22023';
  end if;

  insert into public.delivery_rounds (
    organization_id, round_date, warehouse_id, label,
    driver_profile_id, vehicle_label, notes, created_by)
  values (v_org, v_date, v_warehouse, v_label,
          nullif(p_payload->>'driver_profile_id', '')::uuid,
          nullif(trim(coalesce(p_payload->>'vehicle_label', '')), ''),
          nullif(trim(coalesce(p_payload->>'notes', '')), ''),
          v_profile)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'stage', 'brouillon');
end;
$$;

-- ---------------------------------------------------------------------------
-- Ajouter un passage — c'est ici que se joue la cohérence de la promesse.
-- ---------------------------------------------------------------------------

create or replace function public.add_round_stop(
  p_round_id uuid,
  p_delivery_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_round public.delivery_rounds%rowtype;
  v_job public.delivery_jobs%rowtype;
  v_slot public.delivery_slots%rowtype;
  v_readiness text;
  v_position integer;
  v_autre text;
begin
  perform app.require_permission('gerer_logistique');
  v_org := app.current_org_id();

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_round.stage not in ('brouillon', 'planifiee') then
    raise exception 'Cette tournée est « % » : elle ne se complète plus.', v_round.stage
      using errcode = '42501';
  end if;

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  -- 1. Un créneau doit avoir été convenu avec le client.
  select * into v_slot from public.delivery_slots
   where delivery_job_id = v_job.id and status = 'retenue';
  if not found then
    raise exception
      'Aucune date n''a été convenue avec ce client : on ne le met pas dans une tournée avant de l''avoir appelé.'
      using errcode = '42501';
  end if;

  -- 2. LA RÈGLE CENTRALE : la tournée doit être le jour promis.
  if v_slot.slot_date <> v_round.round_date then
    raise exception
      'Ce client attend le %, pas le % : changez de tournée plutôt que de trahir la date promise.',
      to_char(v_slot.slot_date, 'DD/MM/YYYY'), to_char(v_round.round_date, 'DD/MM/YYYY')
      using errcode = '42501';
  end if;

  -- 3. Le camion part d'un dépôt : la marchandise doit y être.
  if v_job.origin_warehouse_id is not null
     and v_job.origin_warehouse_id <> v_round.warehouse_id then
    raise exception
      'Ce dossier part d''un autre dépôt que cette tournée.'
      using errcode = '42501';
  end if;

  -- 4. La marchandise est-elle toujours là ? Elle a pu bouger depuis la
  --    promesse. Un dossier autorisé en partiel reste acceptable.
  v_readiness := app.delivery_readiness(v_job.id)->>'readiness';
  if v_readiness not in ('complet', 'partiel')
     or (v_readiness = 'partiel' and not v_job.contact_authorized_partial) then
    raise exception
      'La marchandise de ce dossier n''est plus disponible (%) : prévenez le client avant de charger.',
      v_readiness using errcode = '42501';
  end if;

  -- 5. Pas deux tournées vivantes pour le même dossier.
  select r.label into v_autre
  from public.delivery_round_stops s
  join public.delivery_rounds r on r.id = s.round_id
  where s.delivery_job_id = v_job.id
    and r.id <> v_round.id
    and r.stage <> 'annulee'
    and s.status = 'prevu'
  limit 1;
  if v_autre is not null then
    raise exception 'Ce dossier est déjà prévu dans la tournée « % ».', v_autre
      using errcode = '42501';
  end if;

  select coalesce(max(position), 0) + 1 into v_position
  from public.delivery_round_stops where round_id = v_round.id;

  insert into public.delivery_round_stops (
    organization_id, round_id, delivery_job_id, slot_id, position)
  values (v_org, v_round.id, v_job.id, v_slot.id, v_position);

  return jsonb_build_object(
    'ok', true, 'position', v_position,
    'date_promise', v_slot.slot_date, 'fenetre', v_slot.slot_window);
end;
$$;

create or replace function public.remove_round_stop(p_stop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_stop public.delivery_round_stops%rowtype;
  v_round public.delivery_rounds%rowtype;
begin
  perform app.require_permission('gerer_logistique');
  v_org := app.current_org_id();

  select * into v_stop from public.delivery_round_stops where id = p_stop_id;
  if not found then
    raise exception 'Passage introuvable.';
  end if;
  if v_stop.organization_id <> v_org then
    raise exception 'Accès refusé : ce passage appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_stop.status <> 'prevu' then
    raise exception
      'Ce passage a déjà un résultat (« % ») : il ne se retire plus, il fait partie de l''historique.',
      v_stop.status using errcode = '42501';
  end if;

  select * into v_round from public.delivery_rounds where id = v_stop.round_id;
  if v_round.stage not in ('brouillon', 'planifiee') then
    raise exception 'Cette tournée est « % » : elle ne se modifie plus.', v_round.stage
      using errcode = '42501';
  end if;

  delete from public.delivery_round_stops where id = v_stop.id;

  -- Les positions se referment, sinon l'ordre présenté au livreur comporte
  -- des trous et il doute de la liste.
  with ordonne as (
    select id, row_number() over (order by position) as n
    from public.delivery_round_stops where round_id = v_round.id
  )
  update public.delivery_round_stops s
     set position = o.n + 1000
    from ordonne o where o.id = s.id;
  with ordonne as (
    select id, row_number() over (order by position) as n
    from public.delivery_round_stops where round_id = v_round.id
  )
  update public.delivery_round_stops s
     set position = o.n
    from ordonne o where o.id = s.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Réordonner : l'ordre de passage est le plan de route du livreur.
create or replace function public.reorder_round_stops(
  p_round_id uuid,
  p_stop_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_round public.delivery_rounds%rowtype;
  v_attendu integer;
begin
  perform app.require_permission('gerer_logistique');
  v_org := app.current_org_id();

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_round.stage not in ('brouillon', 'planifiee') then
    raise exception 'Cette tournée est « % » : son ordre ne se change plus.', v_round.stage
      using errcode = '42501';
  end if;

  select count(*) into v_attendu from public.delivery_round_stops
   where round_id = v_round.id;
  -- La liste doit couvrir TOUS les passages, exactement une fois : un ordre
  -- partiel laisserait des passages à une position arbitraire.
  if coalesce(array_length(p_stop_ids, 1), 0) <> v_attendu then
    raise exception 'L''ordre doit citer les % passage(s) de la tournée, pas %.',
      v_attendu, coalesce(array_length(p_stop_ids, 1), 0) using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_stop_ids) as x(id)
    group by x.id having count(*) > 1
  ) then
    raise exception 'Un passage est cité deux fois dans l''ordre.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_stop_ids) as x(id)
    where not exists (select 1 from public.delivery_round_stops s
                       where s.id = x.id and s.round_id = v_round.id)
  ) then
    raise exception 'L''ordre cite un passage qui n''appartient pas à cette tournée.'
      using errcode = '22023';
  end if;

  -- Décalage d'abord : un index unique n'est pas différable, et l'échange de
  -- deux passages le violerait en cours de route.
  update public.delivery_round_stops
     set position = position + 1000
   where round_id = v_round.id;

  -- « with ordinality » garantit l'ordre du tableau ; un row_number() sur un
  -- unnest nu ne le garantit pas, il l'obtient par chance.
  update public.delivery_round_stops s
     set position = x.n::integer
    from unnest(p_stop_ids) with ordinality as x(id, n)
   where s.id = x.id;

  return jsonb_build_object('ok', true, 'passages', v_attendu);
end;
$$;

-- ===========================================================================
-- 6. Planifier, puis exécuter
-- ===========================================================================

-- Passer la tournée en « planifiée » engage les dossiers : ils prennent
-- l'étape « planifié ». Un livreur et au moins un passage sont exigés, faute
-- de quoi la tournée n'engage rien et le mot serait faux.
create or replace function public.plan_delivery_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_round public.delivery_rounds%rowtype;
  v_passages integer;
begin
  perform app.require_permission('gerer_logistique');
  v_org := app.current_org_id();

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_round.stage <> 'brouillon' then
    raise exception 'Cette tournée est déjà « % ».', v_round.stage using errcode = '42501';
  end if;
  if v_round.driver_profile_id is null then
    raise exception 'Affectez un livreur avant de planifier la tournée.'
      using errcode = '22023';
  end if;

  select count(*) into v_passages from public.delivery_round_stops
   where round_id = v_round.id;
  if v_passages = 0 then
    raise exception 'Cette tournée ne contient aucun passage.' using errcode = '22023';
  end if;

  update public.delivery_rounds set stage = 'planifiee' where id = v_round.id;

  update public.delivery_jobs
     set stage = 'planifie'
   where id in (select delivery_job_id from public.delivery_round_stops
                 where round_id = v_round.id)
     and stage = 'creneau_confirme';

  return jsonb_build_object('ok', true, 'stage', 'planifiee', 'passages', v_passages);
end;
$$;

-- Le camion part.
create or replace function public.start_delivery_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_round public.delivery_rounds%rowtype;
begin
  perform app.require_permission('executer_livraison');
  v_org := app.current_org_id();

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_round.stage <> 'planifiee' then
    raise exception 'Cette tournée est « % » : seule une tournée planifiée démarre.',
      v_round.stage using errcode = '42501';
  end if;

  update public.delivery_rounds set stage = 'en_cours' where id = v_round.id;
  update public.delivery_jobs
     set stage = 'en_cours'
   where id in (select delivery_job_id from public.delivery_round_stops
                 where round_id = v_round.id)
     and stage = 'planifie';

  return jsonb_build_object('ok', true, 'stage', 'en_cours');
end;
$$;

-- ---------------------------------------------------------------------------
-- Résultat d'un passage.
--
-- Livré : le dossier est terminé, ses affectations passent à « livrée » et la
-- marchandise sort du stock, avec son événement daté. Rien de tout cela n'est
-- déductible plus tard : c'est maintenant ou jamais.
--
-- Échec ou report : le dossier RETOURNE au contact et le créneau promis
-- devient caduc. C'est le comportement honnête — une date manquée n'est plus
-- une date, et il faut rappeler le client.
-- ---------------------------------------------------------------------------
create or replace function public.record_round_stop_outcome(
  p_stop_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_stop public.delivery_round_stops%rowtype;
  v_round public.delivery_rounds%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_restants integer;
begin
  v_profile := app.require_permission('executer_livraison');
  v_org := app.current_org_id();

  if p_status not in ('livre', 'echec', 'reporte') then
    raise exception 'Résultat inconnu : « % ». Attendu : livre, echec ou reporte.', p_status
      using errcode = '22023';
  end if;
  if p_status <> 'livre' and v_note is null then
    raise exception 'Un échec ou un report demande un motif : le client devra être rappelé.'
      using errcode = '22023';
  end if;

  select * into v_stop from public.delivery_round_stops where id = p_stop_id;
  if not found then
    raise exception 'Passage introuvable.';
  end if;
  if v_stop.organization_id <> v_org then
    raise exception 'Accès refusé : ce passage appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_stop.status <> 'prevu' then
    raise exception 'Ce passage porte déjà le résultat « % ».', v_stop.status
      using errcode = '42501';
  end if;

  select * into v_round from public.delivery_rounds where id = v_stop.round_id;
  if v_round.stage not in ('planifiee', 'en_cours') then
    raise exception 'La tournée est « % » : aucun résultat ne s''y saisit.', v_round.stage
      using errcode = '42501';
  end if;

  update public.delivery_round_stops
     set status = p_status, outcome_note = v_note,
         recorded_by = v_profile, recorded_at = now()
   where id = v_stop.id;

  if p_status = 'livre' then
    -- La marchandise quitte le stock, et l'événement le date.
    insert into public.logistics_line_events (
      organization_id, logistics_line_id, event_type, warehouse_id,
      occurred_on, quantity, source, recorded_by, notes)
    select v_org, a.logistics_line_id, 'sortie', v_round.warehouse_id,
           v_round.round_date, a.quantity_allocated, 'manuel', v_profile,
           'Livrée en tournée « ' || v_round.label || ' ».'
    from public.delivery_allocations a
    where a.delivery_job_id = v_stop.delivery_job_id and a.status = 'prevue';

    update public.logistics_lines
       set stage = 'sortie'
     where id in (select a.logistics_line_id from public.delivery_allocations a
                   where a.delivery_job_id = v_stop.delivery_job_id
                     and a.status = 'prevue');

    update public.delivery_allocations
       set status = 'livree', quantity_delivered = quantity_allocated
     where delivery_job_id = v_stop.delivery_job_id and status = 'prevue';

    update public.delivery_jobs set stage = 'termine' where id = v_stop.delivery_job_id;
  else
    -- Une date manquée n'est plus une date.
    update public.delivery_slots
       set status = 'caduque',
           answered_by = v_profile, answered_at = now(),
           notes = v_note
     where delivery_job_id = v_stop.delivery_job_id and status = 'retenue';

    update public.delivery_allocations
       set status = case when p_status = 'reporte' then 'reportee' else 'refusee' end
     where delivery_job_id = v_stop.delivery_job_id and status = 'prevue';

    update public.delivery_jobs
       set stage = 'pret_a_contacter'
     where id = v_stop.delivery_job_id;
  end if;

  -- Dernier passage traité : la tournée se referme d'elle-même.
  select count(*) into v_restants from public.delivery_round_stops
   where round_id = v_round.id and status = 'prevu';
  if v_restants = 0 then
    update public.delivery_rounds set stage = 'terminee' where id = v_round.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'resultat', p_status,
    'passages_restants', v_restants,
    'tournee', case when v_restants = 0 then 'terminee' else v_round.stage end);
end;
$$;

-- ===========================================================================
-- 7. Lectures
-- ===========================================================================

create or replace function public.list_delivery_rounds(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_from date := nullif(p_filters->>'from', '')::date;
  v_to date := nullif(p_filters->>'to', '')::date;
  v_stage text := nullif(p_filters->>'stage', '');
  v_warehouse uuid := nullif(p_filters->>'warehouse_id', '')::uuid;
  v_limit integer := least(greatest(coalesce((p_filters->>'limit')::integer, 100), 1), 500);
begin
  perform app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  return jsonb_build_object(
    'totals', coalesce((
      select jsonb_build_object(
               'tournees', count(*),
               'brouillons', count(*) filter (where stage = 'brouillon'),
               'planifiees', count(*) filter (where stage = 'planifiee'),
               'en_cours', count(*) filter (where stage = 'en_cours'))
      from public.delivery_rounds
      where organization_id = v_org and stage <> 'annulee'),
      jsonb_build_object('tournees', 0)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.date desc, x.label)
      from (
        select r.id, r.round_date as date, r.label, r.stage, r.vehicle_label,
               w.name as depot,
               p.display_name as livreur,
               (select count(*) from public.delivery_round_stops s
                 where s.round_id = r.id) as passages,
               (select count(*) from public.delivery_round_stops s
                 where s.round_id = r.id and s.status = 'livre') as livres,
               (select count(*) from public.delivery_round_stops s
                 where s.round_id = r.id and s.status in ('echec', 'reporte')) as manques
        from public.delivery_rounds r
        join public.warehouses w on w.id = r.warehouse_id
        left join public.profiles p on p.id = r.driver_profile_id
        where r.organization_id = v_org
          and (v_from is null or r.round_date >= v_from)
          and (v_to is null or r.round_date <= v_to)
          and (v_stage is null or r.stage = v_stage)
          and (v_warehouse is null or r.warehouse_id = v_warehouse)
        order by r.round_date desc, r.label
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;

-- Le plan de route : l'ordre de passage, et rien qui ne serve à conduire.
create or replace function public.get_delivery_round(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_round public.delivery_rounds%rowtype;
  v_can_contact boolean;
begin
  perform app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();
  v_can_contact := app.has_permission('voir_coordonnees_client');

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_round.id,
    'date', v_round.round_date,
    'label', v_round.label,
    'stage', v_round.stage,
    'vehicle_label', v_round.vehicle_label,
    'notes', v_round.notes,
    'depot', (select w.name from public.warehouses w where w.id = v_round.warehouse_id),
    'warehouse_id', v_round.warehouse_id,
    'livreur', (select p.display_name from public.profiles p
                 where p.id = v_round.driver_profile_id),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'position', s.position,
               'statut', s.status,
               'motif', s.outcome_note,
               'dossier_id', d.id,
               'reference', d.reference,
               'client', d.customer_name,
               'telephone', case when v_can_contact then d.customer_phone end,
               'adresse', case when v_can_contact then d.address_line end,
               'code_postal', case when v_can_contact then d.postal_code end,
               'ville', case when v_can_contact then d.city end,
               'acces', case when v_can_contact then d.access_notes end,
               'remise_type', d.remise_type,
               'fenetre', sl.slot_window,
               -- Garde-fou visible : si la date promise ne correspond plus à
               -- celle de la tournée, l'écran doit le crier.
               'date_promise', sl.slot_date,
               'date_incoherente', (sl.slot_date is distinct from v_round.round_date))
             order by s.position)
      from public.delivery_round_stops s
      join public.delivery_jobs d on d.id = s.delivery_job_id
      left join public.delivery_slots sl on sl.id = s.slot_id
      where s.round_id = v_round.id), '[]'::jsonb));
end;
$$;

-- Les dossiers qu'on PEUT encore mettre dans la tournée de ce jour : date
-- promise identique, même dépôt, pas déjà prévus ailleurs.
create or replace function public.list_round_candidates(
  p_date date,
  p_warehouse_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_can_contact boolean;
begin
  perform app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();
  v_can_contact := app.has_permission('voir_coordonnees_client');

  if p_date is null or p_warehouse_id is null then
    raise exception 'Indiquez la date et le dépôt de la tournée.' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.fenetre, x.reference)
    from (
      select d.id, d.reference, d.customer_name as client,
             case when v_can_contact then d.city end as ville,
             case when v_can_contact then d.postal_code end as code_postal,
             d.remise_type, sl.slot_window as fenetre,
             app.delivery_readiness(d.id)->>'readiness' as disponibilite
      from public.delivery_jobs d
      join public.delivery_slots sl
        on sl.delivery_job_id = d.id and sl.status = 'retenue'
      where d.organization_id = v_org
        and sl.slot_date = p_date
        and (d.origin_warehouse_id is null or d.origin_warehouse_id = p_warehouse_id)
        and d.stage in ('creneau_confirme', 'planifie')
        and not exists (
          select 1 from public.delivery_round_stops s
          join public.delivery_rounds r on r.id = s.round_id
          where s.delivery_job_id = d.id
            and r.stage <> 'annulee'
            and s.status = 'prevu')
    ) x), '[]'::jsonb);
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
    'public.create_delivery_round(jsonb)',
    'public.add_round_stop(uuid, uuid)',
    'public.remove_round_stop(uuid)',
    'public.reorder_round_stops(uuid, uuid[])',
    'public.plan_delivery_round(uuid)',
    'public.start_delivery_round(uuid)',
    'public.record_round_stop_outcome(uuid, text, text)',
    'public.list_delivery_rounds(jsonb)',
    'public.get_delivery_round(uuid)',
    'public.list_round_candidates(date, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
