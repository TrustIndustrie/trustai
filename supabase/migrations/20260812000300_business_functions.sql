-- ===========================================================================
-- TRUST AI — migration 3 : fonctions métier atomiques (RPC)
--
-- Toutes les écritures métier passent par ces fonctions :
--  * SECURITY DEFINER avec search_path épinglé et EXECUTE réservé au rôle
--    authenticated ;
--  * l'identité (created_by, received_by, requested_by, decided_by) provient
--    TOUJOURS de auth.uid() — jamais d'un paramètre client ;
--  * chaque fonction rejoue les règles métier V1.2 (paiement strictement
--    positif, jamais supérieur au RAP, total historique conservé après
--    annulation, RAP d'une annulée = 0, motif obligatoire, etc.) ;
--  * chaque fonction est une transaction : tout réussit ou tout échoue.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Calculs financiers (V1.2)
-- ---------------------------------------------------------------------------

-- Total HISTORIQUE d'une commande : TOUTES les lignes (y compris annulées),
-- remises et frais inclus. L'annulation ne modifie jamais ce total.
create or replace function app.order_total_cents(p_order_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select sum(ol.quantity * ol.unit_price_cents - ol.discount_cents)
    from public.order_lines ol
    where ol.order_id = p_order_id
  ), 0)
  - coalesce((select o.discount_cents from public.orders o where o.id = p_order_id), 0)
  + coalesce((select o.delivery_fee_cents from public.orders o where o.id = p_order_id), 0)
$$;

create or replace function app.order_paid_cents(p_order_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(p.amount_cents), 0)
  from public.payments p
  where p.order_id = p_order_id
$$;

-- RAP : 0 pour une commande annulée (l'encaissé devient un remboursement ou
-- avoir à traiter, jamais un reste à payer).
create or replace function app.order_rap_cents(p_order_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when (select o.status from public.orders o where o.id = p_order_id) = 'annulee'
      then 0
    else app.order_total_cents(p_order_id) - app.order_paid_cents(p_order_id)
  end
$$;

-- Référence lisible suivante (MAG-HER-2026-0008, FOU-2026-0017…), protégée
-- contre les doublons concurrents par un verrou transactionnel.
create or replace function app.next_reference(p_org uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_org::text || p_prefix));
  select coalesce(max(nullif(regexp_replace(substr(r.reference, length(p_prefix) + 1), '\D', '', 'g'), '')::integer), 0) + 1
    into v_seq
  from (
    select reference from public.orders where organization_id = p_org and reference like p_prefix || '%'
    union all
    select reference from public.supplier_orders where organization_id = p_org and reference like p_prefix || '%'
    union all
    select reference from public.shipments where organization_id = p_org and reference like p_prefix || '%'
  ) r;
  return p_prefix || lpad(v_seq::text, 4, '0');
end;
$$;

create or replace function app.log_activity(
  p_org uuid,
  p_action text,
  p_details text,
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_logs (organization_id, actor_profile_id, actor_label, action, details, order_id)
  values (
    p_org,
    auth.uid(),
    coalesce((select display_name from public.profiles where id = auth.uid()), 'Système'),
    p_action,
    p_details,
    p_order_id
  );
end;
$$;

-- Garde commune : profil actif obligatoire + permission éventuelle.
create or replace function app.require_permission(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception 'Profil absent ou désactivé : accès refusé.'
      using errcode = '42501';
  end if;
  if p_permission is not null and not app.has_permission(p_permission) then
    raise exception 'Votre rôle ne permet pas cette action (%).', p_permission
      using errcode = '42501';
  end if;
  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profil courant (utilisé par l'interface après connexion)
-- ---------------------------------------------------------------------------
create or replace function public.current_profile()
returns table (
  id uuid,
  display_name text,
  role text,
  primary_store_id uuid,
  active boolean,
  store_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.role,
    p.primary_store_id,
    p.active,
    coalesce(
      (select array_agg(usa.store_id) from public.user_store_access usa
        where usa.profile_id = p.id),
      '{}'
    )
  from public.profiles p
  where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Création atomique d'une commande magasin
-- (commande + lignes + règlements + parcours acquisition + historique)
-- ---------------------------------------------------------------------------
create or replace function public.create_store_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_store uuid;
  v_store_code text;
  v_customer uuid;
  v_order uuid;
  v_reference text;
  v_total_cents integer := 0;
  v_paid_cents integer := 0;
  v_line jsonb;
  v_payment jsonb;
begin
  v_profile := app.require_permission('creer_commande');
  v_org := app.current_org_id();

  v_store := (p_payload->>'store_id')::uuid;
  if v_store is null then
    raise exception 'Le magasin est obligatoire.';
  end if;
  -- Un vendeur ne peut pas créer une commande sur un magasin non autorisé.
  if not app.can_access_store(v_store) then
    raise exception 'Vous n''êtes pas autorisé(e) sur ce magasin.'
      using errcode = '42501';
  end if;
  select s.code into v_store_code
  from public.stores s
  where s.id = v_store and s.organization_id = v_org and s.active;
  if v_store_code is null then
    raise exception 'Magasin introuvable ou inactif.';
  end if;

  if jsonb_array_length(coalesce(p_payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Une commande doit contenir au moins un article.';
  end if;

  -- Règles financières AVANT toute écriture.
  for v_line in select * from jsonb_array_elements(p_payload->'lines')
  loop
    if coalesce((v_line->>'quantity')::integer, 0) <= 0 then
      raise exception 'La quantité de chaque article doit être supérieure à zéro.';
    end if;
    if coalesce((v_line->>'unit_price_cents')::integer, -1) < 0 then
      raise exception 'Le prix unitaire de chaque article est obligatoire.';
    end if;
    if coalesce((v_line->>'off_catalog')::boolean, false)
       and not app.has_permission('produit_hors_catalogue') then
      raise exception 'La saisie hors catalogue est réservée aux responsables.'
        using errcode = '42501';
    end if;
    v_total_cents := v_total_cents
      + (v_line->>'quantity')::integer * (v_line->>'unit_price_cents')::integer
      - coalesce((v_line->>'discount_cents')::integer, 0);
  end loop;
  v_total_cents := v_total_cents
    - coalesce((p_payload->>'discount_cents')::integer, 0)
    + coalesce((p_payload->>'delivery_fee_cents')::integer, 0);

  for v_payment in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb))
  loop
    if coalesce((v_payment->>'amount_cents')::integer, 0) <= 0 then
      raise exception 'Chaque règlement doit avoir un montant strictement supérieur à zéro.';
    end if;
    v_paid_cents := v_paid_cents + (v_payment->>'amount_cents')::integer;
  end loop;
  if v_paid_cents > v_total_cents then
    raise exception 'Le total des règlements dépasse le total de la commande.';
  end if;

  v_reference := app.next_reference(
    v_org,
    'MAG-' || v_store_code || '-' || extract(year from now())::text || '-'
  );

  insert into public.customers (organization_id, name, phone, email, address, postal_code, city, created_by)
  values (
    v_org,
    p_payload->'customer'->>'name',
    p_payload->'customer'->>'phone',
    nullif(p_payload->'customer'->>'email', ''),
    nullif(p_payload->'customer'->>'address', ''),
    nullif(p_payload->'customer'->>'postal_code', ''),
    nullif(p_payload->'customer'->>'city', ''),
    v_profile
  )
  returning id into v_customer;

  -- L'identité de la vendeuse/du vendeur est TOUJOURS le profil connecté.
  insert into public.orders (
    organization_id, reference, origin, store_id, salesperson_profile_id,
    customer_id, ordered_at, desired_at, fulfillment_mode,
    fulfillment_location_label, delivery_fee_cents, discount_cents,
    acquisition_source, notes, created_by
  )
  values (
    v_org, v_reference, 'MAGASIN', v_store, v_profile,
    v_customer,
    coalesce((p_payload->>'ordered_at')::timestamptz, now()),
    (p_payload->>'desired_at')::timestamptz,
    p_payload->>'fulfillment_mode',
    nullif(p_payload->>'fulfillment_location_label', ''),
    coalesce((p_payload->>'delivery_fee_cents')::integer, 0),
    coalesce((p_payload->>'discount_cents')::integer, 0),
    nullif(p_payload->>'acquisition_source', ''),
    nullif(p_payload->>'notes', ''),
    v_profile
  )
  returning id into v_order;

  for v_line in select * from jsonb_array_elements(p_payload->'lines')
  loop
    insert into public.order_lines (
      organization_id, order_id, product_id, variant_id, off_catalog,
      product_name, variant_label, reference, quantity, unit_price_cents,
      discount_cents, supplier_id, alt_supplier_id,
      destination_warehouse_id, comments
    )
    values (
      v_org, v_order,
      (v_line->>'product_id')::uuid,
      (v_line->>'variant_id')::uuid,
      coalesce((v_line->>'off_catalog')::boolean, false),
      v_line->>'product_name',
      nullif(v_line->>'variant_label', ''),
      nullif(v_line->>'reference', ''),
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price_cents')::integer,
      coalesce((v_line->>'discount_cents')::integer, 0),
      (v_line->>'supplier_id')::uuid,
      (v_line->>'alt_supplier_id')::uuid,
      (v_line->>'destination_warehouse_id')::uuid,
      nullif(v_line->>'comments', '')
    );
  end loop;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb))
  loop
    insert into public.payments (organization_id, order_id, amount_cents, date, method, store_id, received_by, comment)
    values (
      v_org, v_order,
      (v_payment->>'amount_cents')::integer,
      coalesce((v_payment->>'date')::timestamptz, now()),
      v_payment->>'method',
      v_store,
      v_profile,
      nullif(v_payment->>'comment', '')
    );
  end loop;

  if nullif(p_payload->>'acquisition_source', '') is not null then
    insert into public.acquisition_journeys (organization_id, order_id, source, new_customer)
    values (v_org, v_order, p_payload->>'acquisition_source', true);
  end if;

  perform app.log_activity(
    v_org, 'Commande créée',
    v_reference || ' — ' || jsonb_array_length(p_payload->'lines')::text || ' article(s), saisie magasin.',
    v_order
  );
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ajout d'un règlement (règles V1.2, identité serveur)
-- ---------------------------------------------------------------------------
create or replace function public.add_payment(
  p_order_id uuid,
  p_amount_cents integer,
  p_date timestamptz,
  p_method text,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_order public.orders%rowtype;
  v_rap integer;
  v_payment uuid;
begin
  v_profile := app.require_permission('encaisser_reglement');

  select * into v_order from public.orders
  where id = p_order_id and organization_id = app.current_org_id();
  if not found then
    raise exception 'Commande introuvable.';
  end if;
  if v_order.store_id is not null and not app.can_access_store(v_order.store_id) then
    raise exception 'Vous n''êtes pas autorisé(e) sur le magasin de cette commande.'
      using errcode = '42501';
  end if;
  if v_order.status = 'annulee' then
    raise exception 'Cette commande est annulée : aucun règlement ne peut être ajouté.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Le montant d''un règlement doit être strictement supérieur à zéro.';
  end if;
  v_rap := app.order_rap_cents(p_order_id);
  if v_rap <= 0 then
    raise exception 'Cette commande est déjà soldée (RAP de 0 €).';
  end if;
  if p_amount_cents > v_rap then
    -- Jamais de plafonnement silencieux : la tentative est refusée.
    raise exception 'Le règlement dépasse le reste à payer (% € restants).',
      to_char(v_rap / 100.0, 'FM999999990.00');
  end if;

  insert into public.payments (organization_id, order_id, amount_cents, date, method, store_id, received_by, comment)
  values (
    v_order.organization_id, p_order_id, p_amount_cents,
    coalesce(p_date, now()), p_method, v_order.store_id, v_profile,
    nullif(p_comment, '')
  )
  returning id into v_payment;

  perform app.log_activity(
    v_order.organization_id, 'Règlement enregistré',
    v_order.reference || ' — règlement de ' || to_char(p_amount_cents / 100.0, 'FM999999990.00') || ' €.',
    p_order_id
  );
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Demande d'annulation (jamais d'annulation directe)
-- ---------------------------------------------------------------------------
create or replace function public.request_order_cancellation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_order public.orders%rowtype;
  v_paid integer;
  v_request uuid;
begin
  v_profile := app.require_permission('creer_commande');
  select * into v_order from public.orders
  where id = p_order_id and organization_id = app.current_org_id();
  if not found then
    raise exception 'Commande introuvable.';
  end if;
  if v_order.store_id is not null and not app.can_access_store(v_order.store_id) then
    raise exception 'Vous n''êtes pas autorisé(e) sur le magasin de cette commande.'
      using errcode = '42501';
  end if;
  if v_order.status = 'annulee' then
    raise exception 'Cette commande est déjà annulée.';
  end if;
  if exists (
    select 1 from public.approval_requests
    where type = 'annulation_commande' and related_order_id = p_order_id
      and status = 'en_attente'
  ) then
    raise exception 'Une demande d''annulation est déjà en attente pour cette commande.';
  end if;

  v_paid := app.order_paid_cents(p_order_id);
  insert into public.approval_requests (
    organization_id, type, title, description, related_order_id,
    requested_by, financial_impact_cents
  )
  values (
    v_order.organization_id, 'annulation_commande',
    'Annuler la commande ' || v_order.reference,
    case when v_paid > 0
      then 'L''annulation nécessite une validation humaine. '
        || to_char(v_paid / 100.0, 'FM999999990.00')
        || ' € ont déjà été encaissés : un remboursement ou un avoir sera à traiter.'
      else 'L''annulation d''une commande client est une décision importante : elle nécessite une validation humaine.'
    end,
    p_order_id, v_profile, v_paid
  )
  returning id into v_request;

  perform app.log_activity(
    v_order.organization_id, 'Demande d''annulation créée',
    v_order.reference || ' — en attente de validation.', p_order_id
  );
  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- Décision sur une demande de validation
-- ---------------------------------------------------------------------------
create or replace function public.decide_approval(
  p_request_id uuid,
  p_approved boolean,
  p_reason text default null,
  p_expected_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_request public.approval_requests%rowtype;
  v_order public.orders%rowtype;
  v_so public.supplier_orders%rowtype;
  v_paid integer;
  v_lead integer;
begin
  v_profile := app.require_permission('valider_decision');
  select * into v_request from public.approval_requests
  where id = p_request_id and organization_id = app.current_org_id()
  for update;
  if not found then
    raise exception 'Demande introuvable.';
  end if;
  if v_request.status <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;
  if v_request.type = 'annulation_commande' then
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception 'Le motif est obligatoire pour valider ou refuser une annulation de commande.';
    end if;
    -- Personne ne valide sa propre demande d'annulation.
    if v_request.requested_by = v_profile then
      raise exception 'Vous ne pouvez pas valider ou refuser votre propre demande d''annulation.'
        using errcode = '42501';
    end if;
  end if;

  update public.approval_requests
  set status = case when p_approved then 'approuvee' else 'refusee' end,
      decided_at = now(),
      decided_by = v_profile,
      decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_request_id;

  -- Effets : commande fournisseur
  if v_request.related_supplier_order_id is not null then
    select * into v_so from public.supplier_orders
    where id = v_request.related_supplier_order_id for update;
    if found then
      if p_approved then
        select lead_time_days into v_lead from public.suppliers where id = v_so.supplier_id;
        update public.supplier_orders
        set status = 'validee',
            validated_at = now(),
            validated_by = v_profile,
            expected_at = coalesce(p_expected_at, expected_at,
              case when v_lead is not null then now() + make_interval(days => v_lead) end)
        where id = v_so.id;
        update public.order_lines ol
        set procurement_status = 'commande',
            expected_arrival = coalesce(ol.expected_arrival,
              (select expected_at from public.supplier_orders where id = v_so.id))
        where ol.id in (
          select sol.order_line_id from public.supplier_order_lines sol
          where sol.supplier_order_id = v_so.id and sol.order_line_id is not null
        );
      else
        update public.supplier_orders set status = 'annulee' where id = v_so.id;
        update public.order_lines ol
        set procurement_status = 'a_commander', supplier_order_id = null
        where ol.id in (
          select sol.order_line_id from public.supplier_order_lines sol
          where sol.supplier_order_id = v_so.id and sol.order_line_id is not null
        );
      end if;
    end if;
  end if;

  -- Effets : annulation de commande (V1.2 — l'historique financier est
  -- conservé : totaux dérivés des lignes, règlements jamais supprimés).
  if v_request.type = 'annulation_commande'
     and v_request.related_order_id is not null and p_approved then
    select * into v_order from public.orders
    where id = v_request.related_order_id for update;
    update public.orders
    set status = 'annulee', delivery_status = 'annulee', updated_by = v_profile
    where id = v_order.id;
    update public.order_lines set procurement_status = 'annule'
    where order_id = v_order.id;
    v_paid := app.order_paid_cents(v_order.id);
    if v_paid > 0 then
      perform app.log_activity(
        v_request.organization_id, 'Alerte financière',
        'Remboursement ou avoir à traiter : '
          || to_char(v_paid / 100.0, 'FM999999990.00')
          || ' € (commande ' || v_order.reference || ' annulée après encaissement).',
        v_order.id
      );
    end if;
  end if;

  perform app.log_activity(
    v_request.organization_id,
    case when p_approved then 'Demande validée' else 'Demande refusée' end,
    v_request.title
      || case when nullif(btrim(coalesce(p_reason, '')), '') is not null
           then ' — motif : ' || btrim(p_reason) else '' end,
    v_request.related_order_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Proposition de commande fournisseur (validation humaine obligatoire)
-- ---------------------------------------------------------------------------
create or replace function public.prepare_supplier_order(
  p_supplier_id uuid,
  p_line_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_supplier public.suppliers%rowtype;
  v_reference text;
  v_so uuid;
  v_count integer;
begin
  v_profile := app.require_permission('gerer_achats');
  v_org := app.current_org_id();
  select * into v_supplier from public.suppliers
  where id = p_supplier_id and organization_id = v_org;
  if not found then
    raise exception 'Fournisseur introuvable.';
  end if;
  select count(*) into v_count from public.order_lines
  where id = any(p_line_ids) and organization_id = v_org;
  if v_count = 0 then
    raise exception 'Aucun article à commander chez ce fournisseur.';
  end if;

  v_reference := app.next_reference(v_org, 'FOU-' || extract(year from now())::text || '-');

  insert into public.supplier_orders (organization_id, reference, supplier_id, status, notes, created_by)
  values (v_org, v_reference, p_supplier_id, 'en_attente_validation',
          'Proposition préparée automatiquement — validation humaine obligatoire.', v_profile)
  returning id into v_so;

  insert into public.supplier_order_lines (supplier_order_id, order_line_id, product_name, variant_label, supplier_reference, quantity)
  select v_so, ol.id, ol.product_name, ol.variant_label, ol.reference, ol.quantity
  from public.order_lines ol
  where ol.id = any(p_line_ids) and ol.organization_id = v_org;

  update public.order_lines
  set procurement_status = 'en_attente_validation', supplier_order_id = v_so
  where id = any(p_line_ids) and organization_id = v_org;

  insert into public.approval_requests (organization_id, type, title, description, related_supplier_order_id, requested_by)
  values (
    v_org, 'commande_fournisseur',
    'Valider la commande ' || v_supplier.name || ' (' || v_reference || ')',
    v_count::text || ' article(s) à commander chez ' || v_supplier.name
      || '. Aucun envoi réel ne sera effectué : la validation met simplement à jour le suivi.',
    v_so, v_profile
  );

  perform app.log_activity(
    v_org, 'Proposition de commande fournisseur',
    v_reference || ' (' || v_supplier.name || ') — en attente de validation humaine.'
  );
  return v_so;
end;
$$;

-- ---------------------------------------------------------------------------
-- Relance du lundi
-- ---------------------------------------------------------------------------
create or replace function public.mark_reminder_done(
  p_line_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_line public.order_lines%rowtype;
  v_next_monday timestamptz;
begin
  v_profile := app.require_permission('gerer_achats');
  v_org := app.current_org_id();
  select * into v_line from public.order_lines
  where id = p_line_id and organization_id = v_org for update;
  if not found then
    raise exception 'Article introuvable.';
  end if;
  if p_outcome not in ('indisponible', 'disponible') then
    raise exception 'Résultat de relance invalide.';
  end if;

  -- Prochain lundi strictement futur (date_trunc('week') = lundi).
  v_next_monday := date_trunc('week', now()) + interval '7 days';

  if p_outcome = 'indisponible' then
    update public.order_lines
    set last_reminder_at = now(),
        procurement_status = 'indisponible',
        next_reminder_at = v_next_monday
    where id = p_line_id;
    perform app.log_activity(
      v_org, 'Relance fournisseur effectuée',
      v_line.product_name || ' toujours indisponible — prochaine relance programmée lundi prochain.',
      v_line.order_id
    );
  else
    update public.order_lines
    set last_reminder_at = now(), next_reminder_at = null
    where id = p_line_id;
    if v_line.supplier_id is not null then
      perform public.prepare_supplier_order(v_line.supplier_id, array[p_line_id]);
      perform app.log_activity(
        v_org, 'Relance fournisseur effectuée',
        v_line.product_name || ' de nouveau disponible — proposition de commande fournisseur créée, en attente de validation.',
        v_line.order_id
      );
    else
      update public.order_lines set procurement_status = 'a_verifier'
      where id = p_line_id;
      perform app.log_activity(
        v_org, 'Relance fournisseur effectuée',
        v_line.product_name || ' disponible mais sans fournisseur attribué — à vérifier avant commande.',
        v_line.order_id
      );
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Réception d'un arrivage (partielle ou complète)
-- ---------------------------------------------------------------------------
create or replace function public.receive_shipment(
  p_shipment_id uuid,
  p_receipts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_shipment public.shipments%rowtype;
  v_receipt jsonb;
  v_complete boolean;
  v_started boolean;
begin
  v_profile := app.require_permission('gerer_logistique');
  v_org := app.current_org_id();
  select * into v_shipment from public.shipments
  where id = p_shipment_id and organization_id = v_org for update;
  if not found then
    raise exception 'Arrivage introuvable.';
  end if;

  for v_receipt in select * from jsonb_array_elements(p_receipts)
  loop
    update public.shipment_items
    set quantity_received = least(quantity, greatest(0, (v_receipt->>'quantity_received')::integer))
    where id = (v_receipt->>'item_id')::uuid and shipment_id = p_shipment_id;
  end loop;

  select bool_and(quantity_received >= quantity), bool_or(quantity_received > 0)
    into v_complete, v_started
  from public.shipment_items where shipment_id = p_shipment_id;

  if v_complete then
    update public.shipments set status = 'recu', actual_at = now() where id = p_shipment_id;
  elsif v_started then
    update public.shipments set status = 'recu_partiellement', actual_at = now() where id = p_shipment_id;
  end if;

  -- Étape logistique correspondant à la réception (destination courante).
  -- Les étapes suivantes (ex. dépôt → client) ne sont PAS modifiées.
  if v_started then
    update public.shipment_legs
    set status = case when v_complete then 'recu' else 'recu_partiellement' end,
        actual_at = case when v_complete then now() else actual_at end
    where shipment_id = p_shipment_id
      and destination_label = v_shipment.destination_label;
  end if;

  update public.order_lines ol
  set procurement_status = 'recu_depot'
  where ol.id in (
    select si.order_line_id from public.shipment_items si
    where si.shipment_id = p_shipment_id
      and si.order_line_id is not null
      and si.quantity_received >= si.quantity
  );

  perform app.log_activity(
    v_org,
    case when v_complete then 'Arrivage reçu' else 'Réception partielle' end,
    v_shipment.reference || ' — ' || v_shipment.destination_label || '.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution : uniquement les utilisateurs authentifiés
-- ---------------------------------------------------------------------------
revoke all on function
  public.current_profile(),
  public.create_store_order(jsonb),
  public.add_payment(uuid, integer, timestamptz, text, text),
  public.request_order_cancellation(uuid),
  public.decide_approval(uuid, boolean, text, timestamptz),
  public.prepare_supplier_order(uuid, uuid[]),
  public.mark_reminder_done(uuid, text),
  public.receive_shipment(uuid, jsonb),
  app.order_total_cents(uuid),
  app.order_paid_cents(uuid),
  app.order_rap_cents(uuid),
  app.next_reference(uuid, text),
  app.log_activity(uuid, text, text, uuid),
  app.require_permission(text)
from public, anon;

grant execute on function
  app.order_total_cents(uuid),
  app.order_paid_cents(uuid),
  app.order_rap_cents(uuid),
  public.current_profile(),
  public.create_store_order(jsonb),
  public.add_payment(uuid, integer, timestamptz, text, text),
  public.request_order_cancellation(uuid),
  public.decide_approval(uuid, boolean, text, timestamptz),
  public.prepare_supplier_order(uuid, uuid[]),
  public.mark_reminder_done(uuid, text),
  public.receive_shipment(uuid, jsonb)
to authenticated;
