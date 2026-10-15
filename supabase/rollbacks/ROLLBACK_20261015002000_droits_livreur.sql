-- ============================================================================
-- RETOUR ARRIÈRE — Migration 20 : DROITS DU LIVREUR
-- ----------------------------------------------------------------------------
-- À exécuter AVANT le retour arrière de la migration 19, donc en premier.
--
-- Aucune donnée perdue : cette migration n'a créé ni table ni colonne. Elle
-- retire au rôle `livreur` les deux permissions accordées, et rétablit les
-- quatre fonctions dans leur forme antérieure.
--
-- AVERTISSEMENT. En rétablissant ces fonctions, on retire aussi le
-- cloisonnement qu'elles ont appris : tout détenteur d'`executer_livraison`
-- retrouve la possibilité de lire et de solder les tournées de ses collègues.
-- Comme `livreur` repart sans permission, cela ne concerne en pratique que
-- les rôles d'encadrement, mais autant le savoir.
--
-- `app.delivery_round_scope` est supprimée. Les fonctions rétablies ne
-- l'appellent pas, l'ordre n'a donc pas d'importance.
-- ============================================================================

begin;

-- Le rôle livreur repart sans aucune permission, comme en phase 1.
create or replace function app.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'vendeur' then array[
      'creer_commande','encaisser_reglement']
    when 'responsable_magasin' then array[
      'creer_commande','encaisser_reglement','valider_decision',
      'gerer_encaissements','voir_acquisition','produit_hors_catalogue',
      'voir_coordonnees_client']
    when 'achats' then array[
      'gerer_achats','valider_decision','gerer_catalogue',
      'gerer_referentiel_logistique']
    when 'logistique' then array[
      'gerer_logistique','gerer_livraisons','voir_coordonnees_client']
    when 'comptabilite' then array[
      'gerer_encaissements','voir_montants_livraison']
    when 'responsable_logistique' then array[
      'gerer_logistique','gerer_livraisons','importer_recap',
      'gerer_documents_client','voir_coordonnees_client',
      'voir_montants_livraison','executer_livraison',
      'gerer_referentiel_logistique','valider_decision']
    when 'livreur' then array[]::text[]
    when 'direction' then array[
      'creer_commande','encaisser_reglement','valider_decision','gerer_achats',
      'gerer_logistique','gerer_encaissements','voir_acquisition',
      'gerer_catalogue','produit_hors_catalogue','voir_tous_magasins',
      'gerer_livraisons','importer_recap','gerer_documents_client',
      'voir_coordonnees_client','voir_montants_livraison','executer_livraison',
      'gerer_referentiel_logistique']
    when 'administrateur' then array[
      'creer_commande','encaisser_reglement','valider_decision','gerer_achats',
      'gerer_logistique','gerer_encaissements','voir_acquisition',
      'gerer_catalogue','produit_hors_catalogue','voir_tous_magasins','administrer',
      'gerer_livraisons','importer_recap','gerer_documents_client',
      'voir_coordonnees_client','voir_montants_livraison','executer_livraison',
      'gerer_referentiel_logistique']
    else array[]::text[]
  end
$$;

drop function if exists app.delivery_round_scope();

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

-- Droits d'exécution rétablis à l'identique.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_delivery_rounds(jsonb)',
    'public.get_delivery_round(uuid)',
    'public.start_delivery_round(uuid)',
    'public.record_round_stop_outcome(uuid, text, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
