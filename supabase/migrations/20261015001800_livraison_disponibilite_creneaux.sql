-- ============================================================================
-- TRUST AI — Migration 18 : DISPONIBILITÉ D'UN DOSSIER ET CRÉNEAUX (lot 2A)
-- ----------------------------------------------------------------------------
-- Le socle logistique nomme déjà toute la chaîne du dossier de livraison :
--
--   a_rapprocher → incomplet → pret_a_contacter → contact_en_cours
--                → creneau_confirme → planifie → en_cours → termine
--
-- Mais RIEN ne faisait jamais passer un dossier à `pret_a_contacter`. L'étape
-- était comptée sur le tableau de bord sans qu'aucune fonction ne la
-- déclenche : le mot existait, le mécanisme non. La promesse de date au
-- client se tenait donc de tête, en croisant deux écrans.
--
-- Cette migration pose les deux premières briques manquantes.
--
--   1. LA DISPONIBILITÉ D'UN DOSSIER, calculée et jamais stockée. Un dossier
--      est prêt quand toutes ses lignes affectées sont disponibles dans le
--      dépôt d'où part la livraison. Stocker ce résultat le rendrait faux au
--      premier rafraîchissement du récapitulatif ; il est donc recalculé à
--      chaque lecture, et l'étape du dossier ne bouge QUE sur geste humain.
--
--   2. LES CRÉNEAUX, proposés puis confirmés, avec une porte de validation
--      humaine avant tout contact client.
--
-- TROIS RÈGLES TENUES ICI, et elles viennent de la direction du projet :
--
--   * TRUST AI n'écrit rien dans le Google Sheet, et cette migration ne le
--     touche pas ;
--   * TRUST AI n'envoie RIEN. `propose_delivery_slots` enregistre les
--     créneaux qu'un humain proposera, elle ne contacte personne ;
--   * autoriser le contact d'un client exige `valider_decision`, que
--     l'agent logistique n'a pas et que le responsable logistique a. C'est
--     exactement la validation attendue avant de promettre une date.
--
-- Rejouable et transactionnelle.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Trace de l'autorisation de contact sur le dossier
-- ===========================================================================

-- L'étape seule ne dit ni qui a autorisé ni quand. Une promesse de date
-- engage l'entreprise devant un client : elle doit être attribuable.
alter table public.delivery_jobs
  add column if not exists contact_authorized_at timestamptz;
alter table public.delivery_jobs
  add column if not exists contact_authorized_by uuid references public.profiles(id);
alter table public.delivery_jobs
  add column if not exists contact_authorization_note text;
-- Vrai quand le contact a été autorisé en connaissance d'une disponibilité
-- INCOMPLÈTE : la livraison partielle est un cas réel, mais elle se décide,
-- elle ne se subit pas.
alter table public.delivery_jobs
  add column if not exists contact_authorized_partial boolean not null default false;

-- ===========================================================================
-- 2. Table des créneaux
-- ===========================================================================

create table if not exists public.delivery_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  delivery_job_id uuid not null
    references public.delivery_jobs(id) on delete cascade,
  slot_date date not null,
  -- Trois fenêtres seulement : c'est ce qu'un client retient au téléphone.
  -- Une heure précise serait une promesse que la tournée ne peut pas tenir.
  slot_window text not null check (slot_window in ('matin', 'apres_midi', 'journee')),
  -- Ordre de préférence présenté au client : 1 d'abord.
  rank integer not null default 1 check (rank between 1 and 5),
  status text not null default 'proposee' check (status in (
    'proposee',   -- enregistré, sera proposé au client par un humain
    'retenue',    -- le client a accepté CE créneau
    'refusee',    -- le client a refusé l'ensemble des créneaux proposés
    'caduque'     -- remplacé par une nouvelle proposition, ou écarté
  )),
  origin text not null default 'manuelle' check (origin in ('manuelle', 'calculee')),
  proposed_by uuid references public.profiles(id),
  proposed_at timestamptz not null default now(),
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_slots_job_idx
  on public.delivery_slots (delivery_job_id, slot_date);
create index if not exists delivery_slots_org_status_idx
  on public.delivery_slots (organization_id, status);
-- Un même jour et une même fenêtre ne sont pas proposés deux fois en même
-- temps. Les créneaux caducs et refusés restent, comme trace.
create unique index if not exists delivery_slots_live_key
  on public.delivery_slots (delivery_job_id, slot_date, slot_window)
  where status in ('proposee', 'retenue');
-- Un dossier n'a qu'UN créneau retenu à la fois.
create unique index if not exists delivery_slots_single_retenue_key
  on public.delivery_slots (delivery_job_id)
  where status = 'retenue';

alter table public.delivery_slots enable row level security;
revoke all on public.delivery_slots from anon;
revoke all on public.delivery_slots from authenticated;
drop policy if exists delivery_slots_no_direct_access on public.delivery_slots;
create policy delivery_slots_no_direct_access on public.delivery_slots
  for all to authenticated using (false) with check (false);

drop trigger if exists set_updated_at on public.delivery_slots;
create trigger set_updated_at before update on public.delivery_slots
  for each row execute function app.set_updated_at();

drop trigger if exists same_org_guard on public.delivery_slots;
create trigger same_org_guard
  before insert or update on public.delivery_slots
  for each row execute function app.assert_same_org(
    'delivery_job_id', 'delivery_job',
    'proposed_by', 'profile',
    'answered_by', 'profile');

-- ===========================================================================
-- 3. Disponibilité d'un dossier — source unique de vérité
-- ===========================================================================
--
-- Une seule implémentation, utilisée par la liste de travail ET par le
-- détail. Deux implémentations divergeraient, et un écran annoncerait
-- « prêt » quand l'autre dit « incomplet ».
--
-- Une affectation est PRÊTE si sa ligne est disponible dans le dépôt d'où
-- part la livraison, ou si elle a déjà été livrée (livraison partielle en
-- cours : le reliquat seul commande).
--
-- Un dossier SANS aucune affectation vivante ne vaut jamais « complet ».
-- C'est le piège classique du comptage : sur un ensemble vide, « toutes les
-- lignes sont prêtes » est vrai et parfaitement faux. Le cas est traité en
-- premier, et la suite de tests le vérifie.

create or replace function app.delivery_readiness(p_delivery_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with j as (
    select d.origin_warehouse_id
    from public.delivery_jobs d
    where d.id = p_delivery_job_id
  ),
  a as (
    select (al.status = 'livree'
            or (l.stage = 'disponible'
                and (j.origin_warehouse_id is null
                     or l.current_warehouse_id = j.origin_warehouse_id))) as prete
    from public.delivery_allocations al
    join public.logistics_lines l on l.id = al.logistics_line_id
    cross join j
    where al.delivery_job_id = p_delivery_job_id
      and al.status <> 'annulee'
  )
  select jsonb_build_object(
    'lignes_total', count(*),
    'lignes_pretes', count(*) filter (where prete),
    'lignes_manquantes', count(*) filter (where not prete),
    'readiness', case
      when count(*) = 0 then 'sans_ligne'
      when count(*) filter (where prete) = 0 then 'rien_de_dispo'
      when count(*) filter (where prete) < count(*) then 'partiel'
      else 'complet'
    end)
  from a
$$;

revoke all on function app.delivery_readiness(uuid) from public;
revoke all on function app.delivery_readiness(uuid) from anon;

-- ===========================================================================
-- 4. Liste de travail des dossiers
-- ===========================================================================
--
-- PAS DE CLOISONNEMENT PAR MAGASIN ICI, et c'est délibéré.
--
-- La migration 17 a cloisonné les lectures Skara par magasin, parce qu'un
-- responsable de magasin n'a pas à lire le chiffre d'affaires d'un autre.
-- La logistique est l'inverse : elle sert les trois magasins depuis les
-- dépôts, et `gerer_livraisons` n'est détenue que par les rôles transverses
-- (logistique, responsable logistique, direction, administrateur), aucun
-- desquels n'a de magasin accordé dans `user_store_access`. Cloisonner ici
-- viderait leurs écrans au lieu de protéger quoi que ce soit.
--
-- La permission EST le cloisonnement. Ne pas « corriger » ce point.

create or replace function public.list_delivery_jobs(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_can_contact boolean;
  v_stage text := nullif(p_filters->>'stage', '');
  v_readiness text := nullif(p_filters->>'readiness', '');
  v_warehouse uuid := nullif(p_filters->>'warehouse_id', '')::uuid;
  v_search text := nullif(trim(coalesce(p_filters->>'search', '')), '');
  v_limit integer := least(greatest(coalesce((p_filters->>'limit')::integer, 100), 1), 500);
begin
  perform app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();
  v_can_contact := app.has_permission('voir_coordonnees_client');

  return jsonb_build_object(
    'totals', coalesce((
      select jsonb_build_object(
               'dossiers', count(*),
               'prets', count(*) filter (where r.readiness = 'complet'),
               'partiels', count(*) filter (where r.readiness = 'partiel'),
               'sans_ligne', count(*) filter (where r.readiness = 'sans_ligne'),
               'a_contacter', count(*) filter (where d.stage = 'pret_a_contacter'),
               'contact_en_cours', count(*) filter (where d.stage = 'contact_en_cours'),
               'creneau_confirme', count(*) filter (where d.stage = 'creneau_confirme'))
      from public.delivery_jobs d
      cross join lateral (
        select app.delivery_readiness(d.id)->>'readiness' as readiness) r
      where d.organization_id = v_org
        and d.stage not in ('clos', 'annule')),
      jsonb_build_object('dossiers', 0)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb
                       order by x.priorite desc, x.expected_ready_at nulls last, x.reference)
      from (
        select d.id, d.reference, d.stage, d.remise_type, d.expected_ready_at,
               d.priority as priorite, d.customer_name,
               case when v_can_contact then d.city end as city,
               case when v_can_contact then d.postal_code end as postal_code,
               w.name as depot,
               s.name as magasin,
               d.contact_authorized_at, d.contact_authorized_partial,
               rd.detail->>'readiness' as readiness,
               (rd.detail->>'lignes_total')::int as lignes_total,
               (rd.detail->>'lignes_pretes')::int as lignes_pretes,
               (rd.detail->>'lignes_manquantes')::int as lignes_manquantes,
               -- Créneau retenu, s'il existe : c'est la date promise.
               (select jsonb_build_object('date', sl.slot_date,
                                          'fenetre', sl.slot_window)
                  from public.delivery_slots sl
                 where sl.delivery_job_id = d.id and sl.status = 'retenue'
                 limit 1) as creneau_retenu,
               (select count(*) from public.delivery_slots sl
                 where sl.delivery_job_id = d.id and sl.status = 'proposee')
                 as creneaux_proposes
        from public.delivery_jobs d
        left join public.warehouses w on w.id = d.origin_warehouse_id
        left join public.stores s on s.id = d.store_id
        cross join lateral (select app.delivery_readiness(d.id) as detail) rd
        where d.organization_id = v_org
          and d.stage not in ('clos', 'annule')
          and (v_stage is null or d.stage = v_stage)
          and (v_readiness is null or rd.detail->>'readiness' = v_readiness)
          and (v_warehouse is null or d.origin_warehouse_id = v_warehouse)
          and (v_search is null
               or d.reference ilike '%' || v_search || '%'
               or d.customer_name ilike '%' || v_search || '%'
               or d.skara_order_reference ilike '%' || v_search || '%')
        order by d.priority desc, d.expected_ready_at nulls last, d.reference
        limit v_limit
      ) x), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 5. Détail : ce qui bloque, et les créneaux
-- ===========================================================================

create or replace function public.get_delivery_readiness(p_delivery_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_job public.delivery_jobs%rowtype;
begin
  perform app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_job.id,
    'reference', v_job.reference,
    'stage', v_job.stage,
    'remise_type', v_job.remise_type,
    'expected_ready_at', v_job.expected_ready_at,
    'depot', (select w.name from public.warehouses w where w.id = v_job.origin_warehouse_id),
    'contact_authorized_at', v_job.contact_authorized_at,
    'contact_authorized_partial', v_job.contact_authorized_partial,
    'contact_authorization_note', v_job.contact_authorization_note,
    'disponibilite', app.delivery_readiness(v_job.id),
    -- Le détail ligne à ligne : sans lui, « incomplet » n'indique pas quoi
    -- attendre, et personne ne peut décider de livrer partiellement.
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'allocation_id', al.id,
               'designation', l.designation,
               'quantite_affectee', al.quantity_allocated,
               'quantite_livree', al.quantity_delivered,
               'statut_affectation', al.status,
               'etape_ligne', l.stage,
               'depot_actuel', (select w.name from public.warehouses w
                                 where w.id = l.current_warehouse_id),
               'arrivee_prevue', l.expected_at,
               'prete', (al.status = 'livree'
                         or (l.stage = 'disponible'
                             and (v_job.origin_warehouse_id is null
                                  or l.current_warehouse_id = v_job.origin_warehouse_id))))
             order by l.designation)
      from public.delivery_allocations al
      join public.logistics_lines l on l.id = al.logistics_line_id
      where al.delivery_job_id = v_job.id
        and al.status <> 'annulee'), '[]'::jsonb),
    'creneaux', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sl.id,
               'date', sl.slot_date,
               'fenetre', sl.slot_window,
               'rang', sl.rank,
               'statut', sl.status,
               'origine', sl.origin,
               'propose_le', sl.proposed_at,
               'repondu_le', sl.answered_at,
               'notes', sl.notes)
             order by sl.proposed_at desc, sl.rank)
      from public.delivery_slots sl
      where sl.delivery_job_id = v_job.id), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 6. La porte de validation humaine
-- ===========================================================================
--
-- Autoriser le contact exige `gerer_livraisons` ET `valider_decision`.
-- L'agent logistique (rôle `logistique`) prépare le dossier et voit la
-- disponibilité ; il ne détient pas `valider_decision` et ne peut donc pas
-- ouvrir le contact. Le responsable logistique, la direction et
-- l'administrateur le peuvent. C'est la validation attendue avant de
-- promettre une date à un client.

create or replace function public.authorize_delivery_contact(
  p_delivery_job_id uuid,
  p_note text default null,
  p_allow_partial boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_job public.delivery_jobs%rowtype;
  v_readiness jsonb;
  v_state text;
begin
  v_profile := app.require_permission('gerer_livraisons');
  if not app.has_permission('valider_decision') then
    raise exception 'Autoriser le contact d''un client demande le droit de validation.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_job.stage not in ('a_rapprocher', 'incomplet', 'pret_a_contacter') then
    raise exception
      'Ce dossier est à l''étape « % » : le contact ne s''autorise qu''avant la prise de contact.',
      v_job.stage using errcode = '42501';
  end if;

  v_readiness := app.delivery_readiness(v_job.id);
  v_state := v_readiness->>'readiness';

  if v_state = 'sans_ligne' then
    raise exception
      'Aucune marchandise n''est affectée à ce dossier : il n''y a rien à livrer.'
      using errcode = '42501';
  end if;
  if v_state = 'rien_de_dispo' then
    raise exception
      'Aucune des % ligne(s) de ce dossier n''est disponible : promettre une date serait un engagement en l''air.',
      v_readiness->>'lignes_total' using errcode = '42501';
  end if;
  -- Une disponibilité partielle n'est pas refusée, elle est ASSUMÉE : il faut
  -- le dire explicitement, et le dossier en gardera la trace.
  if v_state = 'partiel' and not p_allow_partial then
    raise exception
      '% ligne(s) sur % ne sont pas disponibles. Pour livrer partiellement, autorisez-le explicitement.',
      v_readiness->>'lignes_manquantes', v_readiness->>'lignes_total'
      using errcode = '42501';
  end if;

  update public.delivery_jobs
     set stage = 'pret_a_contacter',
         contact_authorized_at = now(),
         contact_authorized_by = v_profile,
         contact_authorization_note = nullif(trim(coalesce(p_note, '')), ''),
         contact_authorized_partial = (v_state = 'partiel')
   where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'stage', 'pret_a_contacter',
    'disponibilite', v_readiness,
    'partielle', v_state = 'partiel');
end;
$$;

-- ===========================================================================
-- 7. Enregistrer les créneaux à proposer
-- ===========================================================================
--
-- Cette fonction N'ENVOIE RIEN. Elle enregistre les créneaux qu'un humain
-- proposera au client, par téléphone ou par message. Aucune notification,
-- aucun courriel, aucun appel à un service extérieur : c'est la règle posée
-- pour tout le projet, et elle s'applique ici comme ailleurs.

create or replace function public.propose_delivery_slots(
  p_delivery_job_id uuid,
  p_slots jsonb,
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
  v_job public.delivery_jobs%rowtype;
  v_count integer;
  v_inserted integer := 0;
  v_slot jsonb;
  v_date date;
  v_window text;
  v_rank integer;
  v_seen text[] := '{}';
  v_key text;
begin
  v_profile := app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  -- La porte de validation : sans autorisation, pas de date proposée.
  if v_job.contact_authorized_at is null then
    raise exception
      'Le contact de ce client n''a pas été autorisé : aucune date ne peut être proposée.'
      using errcode = '42501';
  end if;
  if v_job.stage not in ('pret_a_contacter', 'contact_en_cours') then
    raise exception
      'Ce dossier est à l''étape « % » : les créneaux se proposent après autorisation et avant confirmation.',
      v_job.stage using errcode = '42501';
  end if;

  if jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Les créneaux doivent être fournis sous forme de liste.'
      using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_slots);
  if v_count < 1 or v_count > 5 then
    raise exception 'Proposez entre 1 et 5 créneaux (% reçu(s)).', v_count
      using errcode = '22023';
  end if;

  -- Les créneaux encore en attente de réponse sont remplacés, pas effacés :
  -- ce qui a été proposé un jour reste lisible.
  update public.delivery_slots
     set status = 'caduque', notes = coalesce(notes, 'Remplacé par une nouvelle proposition.')
   where delivery_job_id = v_job.id and status = 'proposee';

  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    begin
      v_date := (v_slot->>'date')::date;
    exception when others then
      raise exception 'Date de créneau illisible : %.', v_slot->>'date'
        using errcode = '22007';
    end;
    if v_date is null then
      raise exception 'Chaque créneau doit porter une date.' using errcode = '22023';
    end if;
    if v_date < current_date then
      raise exception 'Le créneau du % est déjà passé.', to_char(v_date, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;

    v_window := coalesce(nullif(trim(coalesce(v_slot->>'fenetre', '')), ''), 'journee');
    if v_window not in ('matin', 'apres_midi', 'journee') then
      raise exception 'Fenêtre inconnue : « % ». Attendu : matin, apres_midi ou journee.',
        v_window using errcode = '22023';
    end if;

    v_rank := coalesce((v_slot->>'rang')::integer, v_inserted + 1);
    if v_rank < 1 or v_rank > 5 then
      raise exception 'Rang de préférence hors limites : %.', v_rank using errcode = '22023';
    end if;

    -- Deux fois le même jour et la même fenêtre dans un seul envoi : refusé
    -- ici avec un message clair, plutôt que par une violation d'index.
    v_key := v_date::text || '|' || v_window;
    if v_key = any (v_seen) then
      raise exception 'Le créneau du % en % est proposé deux fois.',
        to_char(v_date, 'DD/MM/YYYY'), v_window using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;

    insert into public.delivery_slots (
      organization_id, delivery_job_id, slot_date, slot_window, rank,
      status, origin, proposed_by, notes)
    values (v_org, v_job.id, v_date, v_window, v_rank,
            'proposee', 'manuelle', v_profile,
            nullif(trim(coalesce(p_note, '')), ''));
    v_inserted := v_inserted + 1;
  end loop;

  update public.delivery_jobs set stage = 'contact_en_cours' where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'stage', 'contact_en_cours',
    'creneaux_enregistres', v_inserted,
    'rappel', 'Aucun message n''a été envoyé : TRUST AI enregistre, un humain propose.');
end;
$$;

-- ===========================================================================
-- 8. Réponse du client
-- ===========================================================================

create or replace function public.confirm_delivery_slot(
  p_slot_id uuid,
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
  v_slot public.delivery_slots%rowtype;
begin
  v_profile := app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  select * into v_slot from public.delivery_slots where id = p_slot_id;
  if not found then
    raise exception 'Créneau introuvable.';
  end if;
  if v_slot.organization_id <> v_org then
    raise exception 'Accès refusé : ce créneau appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_slot.status <> 'proposee' then
    raise exception 'Ce créneau est à l''état « % » : seule une proposition en attente se confirme.',
      v_slot.status using errcode = '42501';
  end if;

  -- Les autres propositions tombent : le client a choisi.
  update public.delivery_slots
     set status = 'caduque'
   where delivery_job_id = v_slot.delivery_job_id
     and status = 'proposee'
     and id <> v_slot.id;

  update public.delivery_slots
     set status = 'retenue',
         answered_by = v_profile,
         answered_at = now(),
         notes = coalesce(nullif(trim(coalesce(p_note, '')), ''), notes)
   where id = v_slot.id;

  update public.delivery_jobs
     set stage = 'creneau_confirme'
   where id = v_slot.delivery_job_id;

  return jsonb_build_object(
    'ok', true,
    'stage', 'creneau_confirme',
    'date', v_slot.slot_date,
    'fenetre', v_slot.slot_window);
end;
$$;

-- Le client refuse tout, ou reste injoignable : le dossier redevient à
-- contacter, et le motif est conservé pour la proposition suivante.
create or replace function public.decline_delivery_slots(
  p_delivery_job_id uuid,
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
  v_job public.delivery_jobs%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_touched integer;
begin
  v_profile := app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  if v_note is null then
    raise exception 'Indiquez le motif : il sert à proposer autre chose.'
      using errcode = '22023';
  end if;

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;
  if v_job.stage <> 'contact_en_cours' then
    raise exception 'Ce dossier est à l''étape « % » : aucun créneau n''est en attente de réponse.',
      v_job.stage using errcode = '42501';
  end if;

  update public.delivery_slots
     set status = 'refusee',
         answered_by = v_profile,
         answered_at = now(),
         notes = v_note
   where delivery_job_id = v_job.id and status = 'proposee';
  get diagnostics v_touched = row_count;

  update public.delivery_jobs set stage = 'pret_a_contacter' where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'stage', 'pret_a_contacter',
    'creneaux_refuses', v_touched);
end;
$$;

-- ===========================================================================
-- 9. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_delivery_jobs(jsonb)',
    'public.get_delivery_readiness(uuid)',
    'public.authorize_delivery_contact(uuid, text, boolean)',
    'public.propose_delivery_slots(uuid, jsonb, text)',
    'public.confirm_delivery_slot(uuid, text)',
    'public.decline_delivery_slots(uuid, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
