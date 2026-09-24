-- ============================================================================
-- TRUST AI — Migration 14 : PANIERS ABANDONNÉS (collecte et attribution)
-- ----------------------------------------------------------------------------
-- Shopify n'émet AUCUN événement « panier abandonné » : l'abandon est une
-- absence d'événement. Les paniers sont donc LUS périodiquement dans l'API
-- Admin, qui renvoie ceux que Shopify considère déjà abandonnés, avec leur
-- lien de récupération. Ce lien ne peut pas être reconstruit : sans lui, une
-- relance renverrait le client à un panier vide.
--
-- Ce que cette migration installe :
--
--   1. `shopify_abandoned_checkouts` — un panier abandonné par ligne, mis à
--      jour de façon IDEMPOTENTE à chaque lecture (clé : l'identifiant de
--      checkout Shopify). Une exclusion humaine et une récupération ne sont
--      JAMAIS écrasées par une lecture suivante.
--
--   2. `abandoned_checkout_events` — historique en AJOUT SEUL : découverte,
--      changement de statut, exclusion, réintégration, récupération.
--
--   3. `customer_messages` — file d'envoi. AUCUN message n'est planifié ni
--      envoyé par cette migration : la table existe pour que le lot suivant
--      n'ait pas à modifier le schéma, et son index unique porte déjà la
--      règle d'idempotence (un seul message par panier et par modèle).
--
--   4. `message_suppressions` — désinscriptions. Une adresse présente ici
--      rend le panier inéligible, immédiatement et sans exception.
--
--   5. `orders.shopify_checkout_token` + déclencheur d'ATTRIBUTION : dès
--      qu'une commande porte le jeton de checkout d'un panier connu, ce
--      panier passe en « recupere » et ses messages encore planifiés sont
--      annulés. L'attribution est donc atomique et vaut pour tout écrivain,
--      y compris la réception de webhook côté serveur.
--
-- RÈGLE DE CONSENTEMENT, appliquée par la base et non par l'interface : un
-- panier n'est éligible que si Shopify indique un consentement marketing.
-- Sans consentement, le panier est visible mais porte le statut
-- `sans_consentement` et ne peut pas entrer dans la file d'envoi.
--
-- Permissions : lecture `voir_acquisition`, exclusion et réintégration
-- `valider_decision`, synchronisation `administrer`.
--
-- Rejouable et transactionnelle, comme les migrations 9 à 13.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Jeton de checkout sur les commandes (clé d'attribution)
-- ===========================================================================

alter table public.orders
  add column if not exists shopify_checkout_token text;

create index if not exists orders_shopify_checkout_token_idx
  on public.orders (organization_id, shopify_checkout_token)
  where shopify_checkout_token is not null;

-- ===========================================================================
-- 2. Paniers abandonnés
-- ===========================================================================

create table if not exists public.shopify_abandoned_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  shopify_checkout_id text not null,
  checkout_token text,
  abandoned_at timestamptz not null,
  created_at_shopify timestamptz,
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text,
  item_count integer not null default 0 check (item_count >= 0),
  line_items jsonb not null default '[]'::jsonb,
  recovery_url text,
  contact_email text,
  contact_phone text,
  contact_name text,
  -- null = Shopify n'a rien dit ; false = refus explicite ; true = accord.
  marketing_consent boolean,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'sans_contact',
  exclusion_reason text,
  recovered_order_id uuid references public.orders(id) on delete set null,
  recovered_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'shopify_abandoned_checkouts_status_check') then
    alter table public.shopify_abandoned_checkouts
      add constraint shopify_abandoned_checkouts_status_check
      check (status in ('a_relancer', 'sans_contact', 'sans_consentement',
                        'exclu', 'recupere'));
  end if;
  -- Un panier récupéré porte sa commande et sa date, et réciproquement.
  if not exists (select 1 from pg_constraint
                 where conname = 'shopify_abandoned_checkouts_recovered_coherence') then
    alter table public.shopify_abandoned_checkouts
      add constraint shopify_abandoned_checkouts_recovered_coherence
      check ((status = 'recupere') = (recovered_at is not null));
  end if;
  -- Une exclusion est motivée : c'est une décision, pas un effet de bord.
  if not exists (select 1 from pg_constraint
                 where conname = 'shopify_abandoned_checkouts_exclusion_motivee') then
    alter table public.shopify_abandoned_checkouts
      add constraint shopify_abandoned_checkouts_exclusion_motivee
      check (status <> 'exclu'
             or length(trim(coalesce(exclusion_reason, ''))) >= 3);
  end if;
end $$;

create unique index if not exists shopify_abandoned_checkouts_key
  on public.shopify_abandoned_checkouts (organization_id, shopify_checkout_id);
create index if not exists shopify_abandoned_checkouts_token_idx
  on public.shopify_abandoned_checkouts (organization_id, checkout_token)
  where checkout_token is not null;
create index if not exists shopify_abandoned_checkouts_status_idx
  on public.shopify_abandoned_checkouts (organization_id, status, abandoned_at desc);

-- ===========================================================================
-- 3. Historique des paniers (ajout seul)
-- ===========================================================================

create table if not exists public.abandoned_checkout_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  checkout_id uuid not null
    references public.shopify_abandoned_checkouts(id) on delete cascade,
  action text not null
    check (action in ('decouvert', 'statut', 'exclu', 'reintegre', 'recupere')),
  from_status text,
  to_status text,
  source text not null
    check (source in ('synchronisation', 'humain', 'commande')),
  note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz not null default now()
);
create index if not exists abandoned_checkout_events_checkout_idx
  on public.abandoned_checkout_events (checkout_id, decided_at);

-- ===========================================================================
-- 4. File d'envoi (aucun message planifié par cette migration)
-- ===========================================================================

create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  channel text not null check (channel in ('email', 'whatsapp')),
  template text not null,
  recipient text not null,
  subject text,
  body text,
  payload jsonb not null default '{}'::jsonb,
  related_type text not null check (related_type in ('panier_abandonne')),
  related_id uuid not null,
  attempt smallint not null default 1 check (attempt between 1 and 5),
  scheduled_at timestamptz not null,
  status text not null default 'planifie'
    check (status in ('planifie', 'envoye', 'annule', 'echec')),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

-- IDEMPOTENCE : un seul message par destinataire logique et par modèle. Deux
-- planifications simultanées font deux insertions ; une seule passe.
create unique index if not exists customer_messages_key
  on public.customer_messages (organization_id, related_type, related_id, template);
create index if not exists customer_messages_due_idx
  on public.customer_messages (status, scheduled_at)
  where status = 'planifie';

-- ===========================================================================
-- 5. Désinscriptions
-- ===========================================================================

create table if not exists public.message_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  channel text not null check (channel in ('email', 'whatsapp')),
  address text not null,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists message_suppressions_key
  on public.message_suppressions (organization_id, channel, address);

-- ===========================================================================
-- 6. Verrouillage des accès directs (comme les 14 tables précédentes)
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'shopify_abandoned_checkouts',
    'abandoned_checkout_events',
    'customer_messages',
    'message_suppressions'
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

  -- Ajout seul : un événement ne se modifie pas.
  execute 'drop trigger if exists append_only_guard on public.abandoned_checkout_events';
  execute 'create trigger append_only_guard
             before update or delete on public.abandoned_checkout_events
             for each row execute function app.forbid_update_delete()';
end $$;

-- ===========================================================================
-- 7. Contrôle interorganisation : deux nouveaux types d'objet
-- ===========================================================================

-- Sur-ensemble strict de la version de la migration 9 : « order » et
-- « abandoned_checkout » s'ajoutent, rien n'est retiré.
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
    when 'order' then
      select organization_id into v_org from public.orders where id = p_id;
    when 'abandoned_checkout' then
      select organization_id into v_org
      from public.shopify_abandoned_checkouts where id = p_id;
    else
      raise exception 'Type d''objet inconnu pour le contrôle d''organisation : %', p_kind;
  end case;
  return v_org;
end;
$$;
revoke all on function app.org_of(text, uuid) from public, anon, authenticated;

do $$
begin
  execute 'drop trigger if exists same_org_guard on public.shopify_abandoned_checkouts';
  execute $t$create trigger same_org_guard
             before insert or update on public.shopify_abandoned_checkouts
             for each row execute function app.assert_same_org(
               'customer_id', 'customer',
               'recovered_order_id', 'order')$t$;

  execute 'drop trigger if exists same_org_guard on public.abandoned_checkout_events';
  execute $t$create trigger same_org_guard
             before insert or update on public.abandoned_checkout_events
             for each row execute function app.assert_same_org(
               'checkout_id', 'abandoned_checkout',
               'decided_by', 'profile')$t$;
end $$;

-- ===========================================================================
-- 8. Fonctions internes : normalisation et éligibilité
-- ===========================================================================

create or replace function app.normalize_contact(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(trim(coalesce(p_value, ''))), '');
$$;
revoke all on function app.normalize_contact(text) from public, anon, authenticated;

-- Statut d'un panier au regard du CONTACT et du CONSENTEMENT. C'est ici, et
-- nulle part ailleurs, que se joue la règle : sans consentement marketing
-- explicite, un panier n'est pas relançable.
create or replace function app.abandoned_checkout_status(
  p_org uuid,
  p_email text,
  p_consent boolean
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := app.normalize_contact(p_email);
begin
  if v_email is null then
    return 'sans_contact';
  end if;
  if exists (select 1 from public.message_suppressions s
             where s.organization_id = p_org
               and s.channel = 'email'
               and s.address = v_email) then
    return 'exclu';
  end if;
  if p_consent is not true then
    return 'sans_consentement';
  end if;
  return 'a_relancer';
end;
$$;
revoke all on function app.abandoned_checkout_status(uuid, text, boolean)
  from public, anon, authenticated;

-- ===========================================================================
-- 9. Lecture
-- ===========================================================================

create or replace function public.get_abandoned_checkout(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.shopify_abandoned_checkouts%rowtype;
begin
  perform app.require_permission('voir_acquisition');
  v_org := app.current_org_id();

  select * into v_row from public.shopify_abandoned_checkouts where id = p_id;
  if not found then
    raise exception 'Panier introuvable.';
  end if;
  if v_row.organization_id <> v_org then
    raise exception 'Accès refusé : ce panier appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'shopify_checkout_id', v_row.shopify_checkout_id,
    'abandoned_at', v_row.abandoned_at,
    'total_cents', v_row.total_cents,
    'currency', v_row.currency,
    'item_count', v_row.item_count,
    'line_items', v_row.line_items,
    'recovery_url', v_row.recovery_url,
    'contact_email', v_row.contact_email,
    'contact_phone', v_row.contact_phone,
    'contact_name', v_row.contact_name,
    'marketing_consent', v_row.marketing_consent,
    'status', v_row.status,
    'exclusion_reason', v_row.exclusion_reason,
    'recovered_at', v_row.recovered_at,
    'recovered_order_reference', (
      select o.reference from public.orders o where o.id = v_row.recovered_order_id),
    'first_seen_at', v_row.first_seen_at,
    'last_seen_at', v_row.last_seen_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'action', e.action,
               'from_status', e.from_status,
               'to_status', e.to_status,
               'source', e.source,
               'note', e.note,
               'decided_at', e.decided_at,
               'decided_by', p.display_name)
             order by e.decided_at)
      from public.abandoned_checkout_events e
      left join public.profiles p on p.id = e.decided_by
      where e.checkout_id = v_row.id), '[]'::jsonb));
end;
$$;

create or replace function public.list_abandoned_checkouts(
  p_status text default null,
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
    'counts', coalesce((
      select jsonb_object_agg(status, n)
      from (select status, count(*) as n
            from public.shopify_abandoned_checkouts
            where organization_id = v_org
            group by status) c), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(row_to_jsonb(x) order by x.abandoned_at desc)
      from (
        select a.id, a.shopify_checkout_id, a.abandoned_at, a.total_cents,
               a.currency, a.item_count, a.recovery_url is not null as has_recovery_url,
               a.contact_email, a.contact_name, a.marketing_consent, a.status,
               a.exclusion_reason, a.recovered_at,
               (select o.reference from public.orders o
                 where o.id = a.recovered_order_id) as recovered_order_reference
        from public.shopify_abandoned_checkouts a
        where a.organization_id = v_org
          and (p_status is null or a.status = p_status)
        order by a.abandoned_at desc
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 10. Synchronisation idempotente
-- ===========================================================================

create or replace function public.upsert_abandoned_checkouts(
  p_rows jsonb,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- MIGRATION 14 : écriture des paniers lus dans l'API Shopify.
--
-- Idempotente par (organisation, identifiant de checkout). Une lecture ne
-- REVIENT JAMAIS sur une décision : un panier exclu par un humain ou déjà
-- récupéré garde son statut, seules ses données volatiles sont rafraîchies.
--
-- Deux appelants, deux régimes :
--
--   * un ADMINISTRATEUR connecté : permission « administrer » vérifiée,
--     organisation déduite de sa session, l'argument est alors ignoré ;
--
--   * une TÂCHE PLANIFIÉE : appel avec la clé de service, donc sans session
--     ni profil, où la garde de permission échouerait. L'organisation
--     devient obligatoire et explicite. Ce chemin n'élargit aucun droit,
--     puisque la clé de service contourne déjà la RLS ; il évite seulement
--     de dupliquer cette logique hors de la base.
declare
  v_claim_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
  v_org uuid;
  v_row jsonb;
  v_existing public.shopify_abandoned_checkouts%rowtype;
  v_checkout_id text;
  v_email text;
  v_consent boolean;
  v_status text;
  v_customer uuid;
  v_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_preserved integer := 0;
begin
  if v_claim_role = 'service_role' then
    v_org := p_organization_id;
    if v_org is null then
      raise exception 'Organisation obligatoire pour un appel de tâche planifiée.';
    end if;
    if not exists (select 1 from public.organizations o where o.id = v_org) then
      raise exception 'Organisation inconnue.';
    end if;
  else
    perform app.require_permission('administrer');
    v_org := app.current_org_id();
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Un tableau de paniers est attendu.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_checkout_id := nullif(trim(coalesce(v_row->>'shopify_checkout_id', '')), '');
    if v_checkout_id is null then
      raise exception 'Panier sans identifiant Shopify : lecture refusée.';
    end if;
    if (v_row->>'abandoned_at') is null then
      raise exception 'Panier % sans date d''abandon : lecture refusée.', v_checkout_id;
    end if;

    v_email := app.normalize_contact(v_row->>'contact_email');
    v_consent := case when v_row->>'marketing_consent' is null then null
                      else (v_row->>'marketing_consent')::boolean end;

    -- Rattachement au client existant par son adresse, s'il y en a un.
    v_customer := null;
    if v_email is not null then
      select c.id into v_customer
      from public.customers c
      where c.organization_id = v_org
        and app.normalize_contact(c.email) = v_email
      order by c.created_at
      limit 1;
    end if;

    select * into v_existing from public.shopify_abandoned_checkouts
    where organization_id = v_org and shopify_checkout_id = v_checkout_id
    for update;

    if not found then
      v_status := app.abandoned_checkout_status(v_org, v_email, v_consent);
      insert into public.shopify_abandoned_checkouts (
        organization_id, shopify_checkout_id, checkout_token, abandoned_at,
        created_at_shopify, total_cents, currency, item_count, line_items,
        recovery_url, contact_email, contact_phone, contact_name,
        marketing_consent, customer_id, status, exclusion_reason)
      values (
        v_org, v_checkout_id, nullif(v_row->>'checkout_token', ''),
        (v_row->>'abandoned_at')::timestamptz,
        nullif(v_row->>'created_at_shopify', '')::timestamptz,
        coalesce((v_row->>'total_cents')::integer, 0),
        nullif(v_row->>'currency', ''),
        coalesce((v_row->>'item_count')::integer, 0),
        coalesce(v_row->'line_items', '[]'::jsonb),
        nullif(v_row->>'recovery_url', ''),
        v_email,
        app.normalize_contact(v_row->>'contact_phone'),
        nullif(trim(coalesce(v_row->>'contact_name', '')), ''),
        v_consent, v_customer, v_status,
        case when v_status = 'exclu' then 'Adresse désinscrite.' end)
      returning id into v_id;

      insert into public.abandoned_checkout_events (
        organization_id, checkout_id, action, to_status, source, note)
      values (v_org, v_id, 'decouvert', v_status, 'synchronisation',
              'Panier lu dans l''API Shopify.');
      v_created := v_created + 1;

    elsif v_existing.status in ('recupere', 'exclu') then
      -- Décision acquise : on ne rafraîchit que ce qui ne la remet pas en cause.
      update public.shopify_abandoned_checkouts
      set total_cents = coalesce((v_row->>'total_cents')::integer, total_cents),
          item_count = coalesce((v_row->>'item_count')::integer, item_count),
          line_items = coalesce(v_row->'line_items', line_items),
          recovery_url = coalesce(nullif(v_row->>'recovery_url', ''), recovery_url),
          checkout_token = coalesce(nullif(v_row->>'checkout_token', ''), checkout_token),
          last_seen_at = now()
      where id = v_existing.id;
      v_preserved := v_preserved + 1;

    else
      v_status := app.abandoned_checkout_status(v_org, v_email, v_consent);
      update public.shopify_abandoned_checkouts
      set checkout_token = coalesce(nullif(v_row->>'checkout_token', ''), checkout_token),
          abandoned_at = (v_row->>'abandoned_at')::timestamptz,
          total_cents = coalesce((v_row->>'total_cents')::integer, 0),
          currency = coalesce(nullif(v_row->>'currency', ''), currency),
          item_count = coalesce((v_row->>'item_count')::integer, 0),
          line_items = coalesce(v_row->'line_items', '[]'::jsonb),
          recovery_url = coalesce(nullif(v_row->>'recovery_url', ''), recovery_url),
          contact_email = v_email,
          contact_phone = app.normalize_contact(v_row->>'contact_phone'),
          contact_name = nullif(trim(coalesce(v_row->>'contact_name', '')), ''),
          marketing_consent = v_consent,
          customer_id = coalesce(v_customer, customer_id),
          status = v_status,
          exclusion_reason = case when v_status = 'exclu'
                                  then 'Adresse désinscrite.' end,
          last_seen_at = now()
      where id = v_existing.id;

      if v_status <> v_existing.status then
        insert into public.abandoned_checkout_events (
          organization_id, checkout_id, action, from_status, to_status, source, note)
        values (v_org, v_existing.id, 'statut', v_existing.status, v_status,
                'synchronisation', 'Statut recalculé à la lecture.');
      end if;
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform app.log_activity(
    v_org, 'Lecture des paniers abandonnés',
    jsonb_array_length(p_rows)::text || ' panier(s) lu(s), ' ||
    v_created::text || ' nouveau(x), ' || v_updated::text || ' mis à jour, ' ||
    v_preserved::text || ' décision(s) préservée(s).');

  return jsonb_build_object(
    'rows_read', jsonb_array_length(p_rows),
    'created', v_created,
    'updated', v_updated,
    'preserved', v_preserved,
    'eligible', (select count(*) from public.shopify_abandoned_checkouts
                 where organization_id = v_org and status = 'a_relancer'));
end;
$$;

-- ===========================================================================
-- 11. Exclusion et réintégration (décision humaine)
-- ===========================================================================

create or replace function public.set_abandoned_checkout_exclusion(
  p_id uuid,
  p_excluded boolean,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_row public.shopify_abandoned_checkouts%rowtype;
  v_status text;
begin
  v_profile := app.require_permission('valider_decision');
  v_org := app.current_org_id();

  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Une décision doit être motivée (note d''au moins 3 caractères).';
  end if;

  select * into v_row from public.shopify_abandoned_checkouts
  where id = p_id for update;
  if not found then
    raise exception 'Panier introuvable.';
  end if;
  if v_row.organization_id <> v_org then
    raise exception 'Accès refusé : ce panier appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_row.status = 'recupere' then
    raise exception 'Ce panier a été récupéré par la commande % : rien à décider.',
      coalesce((select o.reference from public.orders o
                where o.id = v_row.recovered_order_id), 'inconnue');
  end if;

  if p_excluded then
    v_status := 'exclu';
  else
    -- La réintégration ne force rien : le statut est RECALCULÉ, donc un
    -- panier sans consentement reste non relançable.
    v_status := app.abandoned_checkout_status(
      v_org, v_row.contact_email, v_row.marketing_consent);
    if v_status = 'exclu' then
      raise exception 'Cette adresse est désinscrite : le panier ne peut pas être réintégré.';
    end if;
  end if;

  update public.shopify_abandoned_checkouts
  set status = v_status,
      exclusion_reason = case when p_excluded then trim(p_note) end
  where id = v_row.id;

  insert into public.abandoned_checkout_events (
    organization_id, checkout_id, action, from_status, to_status, source,
    note, decided_by)
  values (v_org, v_row.id,
          case when p_excluded then 'exclu' else 'reintegre' end,
          v_row.status, v_status, 'humain', trim(p_note), v_profile);

  -- Une exclusion vide la file d'envoi de ce panier, sans exception.
  if p_excluded then
    update public.customer_messages
    set status = 'annule', error = 'Panier exclu : ' || trim(p_note)
    where organization_id = v_org
      and related_type = 'panier_abandonne'
      and related_id = v_row.id
      and status = 'planifie';
  end if;

  perform app.log_activity(
    v_org,
    case when p_excluded then 'Panier abandonné exclu'
         else 'Panier abandonné réintégré' end,
    coalesce(v_row.contact_email, v_row.shopify_checkout_id) ||
    ' — ' || trim(p_note) || '.');

  return public.get_abandoned_checkout(v_row.id);
end;
$$;

-- ===========================================================================
-- 12. Attribution : une commande portant le jeton ferme le panier
-- ===========================================================================

create or replace function app.attach_order_to_abandoned_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_before text;
begin
  -- Le statut PRÉCÉDENT est lu avant l'écriture : « returning » renverrait
  -- la nouvelle valeur, et l'historique perdrait l'état de départ.
  for v_id, v_before in
    select id, status
    from public.shopify_abandoned_checkouts
    where organization_id = new.organization_id
      and checkout_token = new.shopify_checkout_token
      and status <> 'recupere'
    for update
  loop
    update public.shopify_abandoned_checkouts
    set status = 'recupere',
        recovered_order_id = new.id,
        recovered_at = now(),
        exclusion_reason = null,
        last_seen_at = now()
    where id = v_id;

    insert into public.abandoned_checkout_events (
      organization_id, checkout_id, action, from_status, to_status, source, note)
    values (new.organization_id, v_id, 'recupere', v_before, 'recupere',
            'commande', 'Commande ' || new.reference || ' reçue.');

    -- Plus rien à envoyer : le client a commandé.
    update public.customer_messages
    set status = 'annule', error = 'Panier récupéré par la commande ' || new.reference
    where organization_id = new.organization_id
      and related_type = 'panier_abandonne'
      and related_id = v_id
      and status = 'planifie';
  end loop;
  return null;
end;
$$;
revoke all on function app.attach_order_to_abandoned_checkout()
  from public, anon, authenticated;

drop trigger if exists attach_abandoned_checkout on public.orders;
create trigger attach_abandoned_checkout
  after insert or update on public.orders
  for each row
  when (new.shopify_checkout_token is not null)
  execute function app.attach_order_to_abandoned_checkout();

-- ===========================================================================
-- 13. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_abandoned_checkouts(text, integer)',
    'public.get_abandoned_checkout(uuid)',
    'public.upsert_abandoned_checkouts(jsonb, uuid)',
    'public.set_abandoned_checkout_exclusion(uuid, boolean, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
