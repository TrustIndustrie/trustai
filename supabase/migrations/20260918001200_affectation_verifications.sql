-- ============================================================================
-- TRUST AI — Migration 12 : AFFECTATION, VÉRIFICATIONS MANQUANTES
-- ----------------------------------------------------------------------------
-- `allocate_to_delivery_job` vérifiait la quantité, l'organisation, la ligne
-- annulée et le dossier clos. Il lui manquait les DEUX contrôles qui comptent
-- le plus sur le terrain :
--
--  1. LA MARCHANDISE EST-ELLE LÀ ? On pouvait affecter à un client une ligne
--     encore chez le fournisseur, ou en cours de transfert. Le dossier passait
--     « prêt à contacter » alors qu'il n'y avait rien à remettre.
--
--  2. EST-ELLE AU BON ENDROIT ? Un dossier rattaché à Aubagne pouvait être
--     servi par une ligne posée à Argenteuil, à 800 km. Rien ne s'y opposait.
--
-- Une ligne n'est affectable que si elle est RÉELLEMENT disponible. Les étapes
-- `recue_argenteuil` et `recue_aubagne` signalent désormais une marchandise
-- physiquement présente mais NON annonçable — réception partielle, ou
-- annulation signalée alors que la marchandise est arrivée. Les affecter
-- reviendrait à promettre au client ce qu'on n'est pas sûr de pouvoir livrer.
--
-- Rejouable et transactionnelle, comme les migrations 9 à 11.
-- ============================================================================

begin;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allocate_to_delivery_job'
      and pg_get_functiondef(p.oid) like '%MIGRATION 12%'
  ) then
    raise notice 'TRUST AI : migration 12 déjà appliquée — réexécution sans effet.';
  end if;
end $$;

create or replace function public.allocate_to_delivery_job(
  p_logistics_line_id uuid,
  p_delivery_job_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
-- MIGRATION 12 : ajoute les contrôles de disponibilité et de dépôt.
declare
  v_profile uuid;
  v_org uuid;
  v_line public.logistics_lines%rowtype;
  v_job public.delivery_jobs%rowtype;
  v_already integer;
  v_existing uuid;
  v_id uuid;
  v_blocking integer;
begin
  v_profile := app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité affectée doit être strictement positive.';
  end if;

  -- VERROU : la ligne est verrouillée pour toute la transaction. Deux appels
  -- simultanés sont sérialisés, ce qui rend la suraffectation impossible.
  select * into v_line
  from public.logistics_lines
  where id = p_logistics_line_id
  for update;

  if not found then
    raise exception 'Ligne logistique introuvable.';
  end if;
  -- ISOLATION : la ligne doit appartenir à l'organisation de l'appelant.
  if v_line.organization_id <> v_org then
    raise exception 'Accès refusé : cette ligne appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_line.stage = 'annulee' then
    raise exception 'Ligne annulée : aucune affectation possible.';
  end if;

  -- ---------------------------------------------------------------------
  -- NOUVEAU 1 : la marchandise doit être réellement disponible.
  -- ---------------------------------------------------------------------
  if v_line.stage = 'sortie' then
    raise exception
      'Marchandise déjà sortie le % : elle n''est plus affectable.',
      coalesce(v_line.exit_at::text, 'date inconnue');
  end if;
  if v_line.stage <> 'disponible' then
    raise exception
      'Marchandise non disponible (étape « % ») : affectation impossible tant '
      'qu''elle n''est pas arrivée et sans réserve.', v_line.stage;
  end if;

  -- Une anomalie BLOQUANTE non résolue interdit d'engager la marchandise
  -- auprès d'un client, même si l'étape dit « disponible ».
  select count(*) into v_blocking
  from public.logistics_anomalies
  where logistics_line_id = p_logistics_line_id
    and severity = 'bloquant'
    and resolved_at is null;
  if v_blocking > 0 then
    raise exception
      '% anomalie(s) bloquante(s) sur cette ligne : à trancher avant toute affectation.',
      v_blocking;
  end if;

  -- Une ligne absente du récapitulatif n'est plus une source fiable.
  if v_line.missing_since is not null then
    raise exception
      'Ligne absente du récapitulatif depuis le % : affectation refusée.',
      v_line.missing_since::date;
  end if;

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  -- ISOLATION : le dossier aussi.
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_job.stage in ('annule','clos') then
    raise exception 'Dossier clos ou annulé : aucune affectation possible.';
  end if;

  -- ---------------------------------------------------------------------
  -- NOUVEAU 2 : cohérence de dépôt.
  -- Quand le dossier précise d'où part la marchandise, la ligne doit s'y
  -- trouver. Un dossier Aubagne ne peut pas être servi depuis Argenteuil.
  -- ---------------------------------------------------------------------
  if v_job.origin_warehouse_id is not null
     and v_line.current_warehouse_id is not null
     and v_job.origin_warehouse_id <> v_line.current_warehouse_id then
    raise exception
      'Dépôts incohérents : le dossier part de « % » alors que la marchandise est à « % ».',
      coalesce((select name from public.warehouses
                where id = v_job.origin_warehouse_id), '?'),
      coalesce((select name from public.warehouses
                where id = v_line.current_warehouse_id), '?');
  end if;

  -- Recalcul DANS la transaction, après verrou.
  select coalesce(sum(quantity_allocated), 0) into v_already
  from public.delivery_allocations
  where logistics_line_id = p_logistics_line_id
    and status <> 'annulee';

  if v_already + p_quantity > v_line.quantity then
    raise exception
      'Quantité indisponible : % déjà affecté(s) sur % — impossible d''en affecter % de plus.',
      v_already, v_line.quantity, p_quantity;
  end if;

  -- Affectation existante pour ce couple ligne/dossier : on la complète.
  select id into v_existing
  from public.delivery_allocations
  where logistics_line_id = p_logistics_line_id
    and delivery_job_id = p_delivery_job_id
    and status <> 'annulee';

  if v_existing is not null then
    update public.delivery_allocations
    set quantity_allocated = quantity_allocated + p_quantity,
        decided_by = v_profile,
        decided_at = now()
    where id = v_existing;
    v_id := v_existing;
  else
    insert into public.delivery_allocations (
      organization_id, logistics_line_id, delivery_job_id,
      quantity_allocated, decided_by, decided_at
    )
    values (v_org, p_logistics_line_id, p_delivery_job_id,
            p_quantity, v_profile, now())
    returning id into v_id;
  end if;

  perform app.log_activity(
    v_org,
    'Affectation logistique',
    v_job.reference || ' — ' || p_quantity::text || ' × « ' ||
    v_line.designation || ' » affecté(s) au dossier.'
  );

  return v_id;
end;
$$;

do $$
begin
  execute 'revoke all on function public.allocate_to_delivery_job(uuid, uuid, integer) from public';
  execute 'revoke all on function public.allocate_to_delivery_job(uuid, uuid, integer) from anon';
  execute 'grant execute on function public.allocate_to_delivery_job(uuid, uuid, integer) to authenticated';
end $$;

commit;
