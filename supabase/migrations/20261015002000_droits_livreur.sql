-- ============================================================================
-- TRUST AI — Migration 20 : DROITS DU LIVREUR (lot 2C)
-- ----------------------------------------------------------------------------
-- Depuis la phase 1, le rôle `livreur` n'avait AUCUNE permission : décision
-- assumée, le socle liant son ouverture à une phase dédiée avec ses propres
-- contrôles. Les tournées existent désormais, le moment est venu.
--
-- CE QUE LE LIVREUR REÇOIT, ET POURQUOI CHAQUE CHOIX
--
--   * `voir_coordonnees_client` — il ne peut pas livrer sans l'adresse et le
--     téléphone. C'est la raison d'être de son métier, pas une facilité.
--   * `executer_livraison` — il constate le résultat sur place. Un résultat
--     saisi le soir au bureau, de mémoire, vaut moins que rien.
--
-- CE QU'IL NE REÇOIT PAS
--
--   * `voir_montants_livraison` — les sommes à encaisser. Par DÉFAUT il ne
--     les voit pas : exposer des montants à qui n'encaisse pas est un risque
--     gratuit. Si vos livreurs encaissent au domicile, c'est une décision à
--     prendre, et elle tient en une ligne : ajouter cette permission au rôle.
--     Tout le reste est déjà câblé, la fonction de lecture sert les montants
--     dès que la permission est là.
--   * `gerer_livraisons` et `gerer_logistique` — il ne compose pas les
--     tournées, il les exécute.
--
-- LE CLOISONNEMENT, QUI EST LE CŒUR DE CETTE MIGRATION
--
-- Un livreur ne voit QUE les tournées dont il est le livreur. Sans cela,
-- `executer_livraison` lui donnerait les coordonnées de tous les clients de
-- l'entreprise, et le droit de clôturer les passages de ses collègues.
--
-- Plutôt que d'écrire des fonctions parallèles pour le terrain — deux
-- implémentations finissent toujours par diverger — les quatre fonctions
-- existantes apprennent à se restreindre : vision globale avec
-- `gerer_livraisons`, ses propres tournées seulement avec
-- `executer_livraison`.
--
-- `get_delivery_round` perd au passage son caractère `stable`, car elle
-- journalise désormais la consultation des coordonnées dans
-- `sensitive_access_logs`, comme le fait déjà `get_delivery_job`. Une
-- fonction `stable` ne peut rien écrire : le choix est entre la traçabilité
-- et l'optimisation, et pour des adresses de clients la traçabilité gagne.
--
-- Rejouable et transactionnelle.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. La matrice des rôles
-- ===========================================================================

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
    -- Migration 20 : le terrain s'ouvre. Strictement le nécessaire pour
    -- livrer et constater, et rien de plus. Les montants à encaisser restent
    -- en dehors tant que personne ne décide le contraire.
    when 'livreur' then array[
      'voir_coordonnees_client','executer_livraison']
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

-- ===========================================================================
-- 2. Qui voit quelles tournées
-- ===========================================================================
--
-- Une seule règle, écrite une fois, relue par chaque fonction :
--   * `gerer_livraisons`  → toutes les tournées de l'organisation ;
--   * `executer_livraison` seul → les siennes, et rien d'autre.
--
-- Retourne null quand le profil n'a aucun des deux : les appelantes en
-- tirent un refus franc.

create or replace function app.delivery_round_scope()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.has_permission('gerer_livraisons') then 'global'
    when app.has_permission('executer_livraison') then 'propre'
    else null
  end
$$;

revoke all on function app.delivery_round_scope() from public;
revoke all on function app.delivery_round_scope() from anon;

-- ===========================================================================
-- 3. Liste des tournées, cloisonnée
-- ===========================================================================

create or replace function public.list_delivery_rounds(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_scope text;
  v_global boolean;
  v_from date := nullif(p_filters->>'from', '')::date;
  v_to date := nullif(p_filters->>'to', '')::date;
  v_stage text := nullif(p_filters->>'stage', '');
  v_warehouse uuid := nullif(p_filters->>'warehouse_id', '')::uuid;
  v_limit integer := least(greatest(coalesce((p_filters->>'limit')::integer, 100), 1), 500);
begin
  v_profile := app.require_permission(null);
  v_scope := app.delivery_round_scope();
  if v_scope is null then
    raise exception 'Votre rôle ne permet pas de consulter les tournées.'
      using errcode = '42501';
  end if;
  v_global := v_scope = 'global';
  v_org := app.current_org_id();

  return jsonb_build_object(
    'scope', v_scope,
    'totals', coalesce((
      select jsonb_build_object(
               'tournees', count(*),
               'brouillons', count(*) filter (where stage = 'brouillon'),
               'planifiees', count(*) filter (where stage = 'planifiee'),
               'en_cours', count(*) filter (where stage = 'en_cours'))
      from public.delivery_rounds
      where organization_id = v_org and stage <> 'annulee'
        and (v_global or driver_profile_id = v_profile)),
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
          and (v_global or r.driver_profile_id = v_profile)
          and (v_from is null or r.round_date >= v_from)
          and (v_to is null or r.round_date <= v_to)
          and (v_stage is null or r.stage = v_stage)
          and (v_warehouse is null or r.warehouse_id = v_warehouse)
        order by r.round_date desc, r.label
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 4. Le plan de route, cloisonné et journalisé
-- ===========================================================================
--
-- Cette fonction n'est plus `stable` : elle écrit une ligne de journal quand
-- des coordonnées de clients sont servies. Pour des adresses, la traçabilité
-- prime sur l'optimisation.

create or replace function public.get_delivery_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_scope text;
  v_round public.delivery_rounds%rowtype;
  v_can_contact boolean;
  v_can_amounts boolean;
begin
  v_profile := app.require_permission(null);
  v_scope := app.delivery_round_scope();
  if v_scope is null then
    raise exception 'Votre rôle ne permet pas de consulter les tournées.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();
  v_can_contact := app.has_permission('voir_coordonnees_client');
  v_can_amounts := app.has_permission('voir_montants_livraison');

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  -- Même message et même code que pour une autre organisation : un livreur
  -- n'apprend rien de l'existence des tournées de ses collègues.
  if v_scope = 'propre' and v_round.driver_profile_id is distinct from v_profile then
    raise exception 'Accès refusé : cette tournée n''est pas la vôtre.'
      using errcode = '42501';
  end if;

  if v_can_contact then
    insert into public.sensitive_access_logs (
      organization_id, profile_id, action, object_type, object_id, context)
    values (v_org, v_profile, 'consultation_coordonnees',
            'delivery_round', v_round.id, 'get_delivery_round');
  end if;
  if v_can_amounts then
    insert into public.sensitive_access_logs (
      organization_id, profile_id, action, object_type, object_id, context)
    values (v_org, v_profile, 'consultation_montants',
            'delivery_round', v_round.id, 'get_delivery_round');
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
    'scope', v_scope,
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
               'date_promise', sl.slot_date,
               'date_incoherente', (sl.slot_date is distinct from v_round.round_date),
               -- Montant restant à encaisser : servi UNIQUEMENT à qui détient
               -- `voir_montants_livraison`. Recomposé comme ailleurs, valeur
               -- d'extraction remplacée par la dernière correction du champ.
               'a_encaisser', case when v_can_amounts then (
                 select coalesce(
                          app.last_correction_int(e.id, 'amount_to_collect_cents'),
                          e.amount_to_collect_cents)
                 from public.skara_documents doc
                 join public.skara_document_extractions e on e.document_id = doc.id
                 where doc.delivery_job_id = d.id
                 order by e.extracted_at desc, e.id desc
                 limit 1) end)
             order by s.position)
      from public.delivery_round_stops s
      join public.delivery_jobs d on d.id = s.delivery_job_id
      left join public.delivery_slots sl on sl.id = s.slot_id
      where s.round_id = v_round.id), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 5. Départ de tournée, cloisonné
-- ===========================================================================

create or replace function public.start_delivery_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_round public.delivery_rounds%rowtype;
begin
  v_profile := app.require_permission('executer_livraison');
  v_org := app.current_org_id();

  select * into v_round from public.delivery_rounds where id = p_round_id;
  if not found then
    raise exception 'Tournée introuvable.';
  end if;
  if v_round.organization_id <> v_org then
    raise exception 'Accès refusé : cette tournée appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  -- Un livreur ne démarre que sa propre tournée.
  if not app.has_permission('gerer_livraisons')
     and v_round.driver_profile_id is distinct from v_profile then
    raise exception 'Accès refusé : cette tournée n''est pas la vôtre.'
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

-- ===========================================================================
-- 6. Résultat d'un passage, cloisonné
-- ===========================================================================
--
-- Même corps qu'en migration 19, augmenté du seul contrôle qui manquait :
-- un livreur ne solde que les passages de SA tournée. Sans lui,
-- `executer_livraison` permettrait de clôturer la tournée d'un collègue.

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
  -- Le contrôle ajouté par la migration 20.
  if not app.has_permission('gerer_livraisons')
     and v_round.driver_profile_id is distinct from v_profile then
    raise exception 'Accès refusé : ce passage appartient à la tournée d''un autre livreur.'
      using errcode = '42501';
  end if;
  if v_round.stage not in ('planifiee', 'en_cours') then
    raise exception 'La tournée est « % » : aucun résultat ne s''y saisit.', v_round.stage
      using errcode = '42501';
  end if;

  update public.delivery_round_stops
     set status = p_status, outcome_note = v_note,
         recorded_by = v_profile, recorded_at = now()
   where id = v_stop.id;

  if p_status = 'livre' then
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
-- 7. Droits d'exécution
-- ===========================================================================

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
