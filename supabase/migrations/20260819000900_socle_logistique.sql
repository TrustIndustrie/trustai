-- ============================================================================
-- TRUST AI — Migration 9 : SOCLE LOGISTIQUE (phase 1)
-- ----------------------------------------------------------------------------
-- Pose les fondations de données, de sécurité et de rôles du TRUST AI
-- logistique. Cette migration NE LIT PAS le récapitulatif, NE TRAITE AUCUN
-- PDF et NE CONTACTE PERSONNE : elle crée uniquement le terrain des phases 2
-- et 3.
--
-- Contenu (chiffres à retrouver à l'identique dans les tests et le rollback) :
--   * 13 nouvelles tables ;
--   *  7 nouvelles permissions (11 existantes + 7 = 18) ;
--   *  2 nouveaux rôles (7 existants + 2 = 9) ;
--   *  4 fonctions RPC.
--
-- SÉCURITÉ — décisions E15 / protections 1 et 2 :
--   * AUCUN droit direct (select/insert/update/delete) sur les 13 tables pour
--     `anon` et `authenticated` : une requête envoyée directement à l'API
--     PostgREST échoue, y compris pour un administrateur. La protection porte
--     donc sur les COLONNES autant que sur les lignes ;
--   * RLS activée malgré tout (défense en profondeur) ;
--   * accès exclusivement par fonctions `security definer` qui vérifient la
--     permission ET l'organisation issues de auth.uid() — jamais d'un
--     identifiant fourni par le navigateur ;
--   * `revoke execute ... from public, anon` sur chaque RPC (PostgreSQL
--     accorde EXECUTE à PUBLIC par défaut) ;
--   * `search_path = ''` sur toutes les fonctions : références entièrement
--     qualifiées.
--
-- IDEMPOTENCE : la migration est rejouable (if not exists / drop-create /
-- create or replace). Une seconde exécution accidentelle ne crée aucun
-- doublon de table, contrainte, index, politique, droit ou déclencheur.
--
-- TRANSACTION : tout ou rien. En cas d'erreur, aucune modification n'est
-- conservée.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Garde-fou : signaler une réapplication (sans bloquer, la migration
--    étant rejouable). Le message apparaît dans la sortie du SQL Editor.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'logistics_lines'
  ) then
    raise notice 'TRUST AI : migration 9 déjà appliquée — réexécution sans effet (idempotente).';
  end if;
end $$;

-- ===========================================================================
-- 1. RÉFÉRENTIEL DU RÉCAPITULATIF (tables 1-2)
-- ===========================================================================

-- Table 1/13
create table if not exists public.recap_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('google_sheet', 'import_fichier')),
  label text not null,
  spreadsheet_id text,
  sheet_name text,
  header_row integer not null default 1 check (header_row >= 1),
  id_column text,                       -- colonne « ID TRUST » (Apps Script)
  column_mapping jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  last_read_at timestamptz,
  last_read_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, label)
);

-- Table 2/13 — journal des lectures. `trigger_type` + `triggered_by_profile_id`
-- typés séparément (jamais un champ mixte).
create table if not exists public.recap_reads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source_id uuid not null references public.recap_sources(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('automatique', 'manuel')),
  triggered_by_profile_id uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_created integer not null default 0 check (rows_created >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  rows_ignored integer not null default 0 check (rows_ignored >= 0),
  errors_count integer not null default 0 check (errors_count >= 0),
  report jsonb not null default '{}'::jsonb,
  -- Un déclenchement manuel identifie forcément son auteur.
  constraint recap_reads_manual_author_check check (
    trigger_type <> 'manuel' or triggered_by_profile_id is not null
  )
);

-- ===========================================================================
-- 2. LIGNES LOGISTIQUES ET LEURS ÉVÉNEMENTS (tables 3-4)
-- ===========================================================================

-- Table 3/13 — un article attendu ou disponible.
-- `origin` distingue le récapitulatif, le stock local et l'exception manuelle :
-- aucune fausse ligne de Google Sheets n'est jamais fabriquée.
create table if not exists public.logistics_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  origin text not null check (origin in ('recap', 'stock_local', 'exception_manuelle')),
  origin_reason text,
  source_id uuid references public.recap_sources(id),
  recap_row_id text,                    -- « ID TRUST » lu dans le Sheet
  recap_row_fingerprint text,           -- filet tant que l'ID n'existe pas
  recap_date date,
  supplier_label text,
  supplier_id uuid references public.suppliers(id),
  supplier_reference text,
  supplier_order_ref text,              -- colonne « ORDER » = n° FOURNISSEUR
  designation text not null,
  variant_id uuid references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  customer_label text,
  expected_at date,
  comments text,
  stage text not null default 'a_commander' check (stage in (
    'a_commander','commandee','attendue','recue_argenteuil','en_transfert',
    'recue_aubagne','disponible','sortie','annulee'
  )),
  current_warehouse_id uuid references public.warehouses(id),
  destination_warehouse_id uuid references public.warehouses(id),
  destination_confidence text not null default 'deduite'
    check (destination_confidence in ('sure', 'deduite', 'ambigue')),
  raw_row jsonb,
  created_by uuid references public.profiles(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Origine « recap » : rattachement au fichier obligatoire.
  constraint logistics_lines_recap_origin_check check (
    origin <> 'recap'
    or (source_id is not null and recap_row_fingerprint is not null)
  ),
  -- Origine hors récap : motif obligatoire, aucun champ de récap.
  constraint logistics_lines_manual_origin_check check (
    origin = 'recap'
    or (origin_reason is not null
        and source_id is null
        and recap_row_id is null
        and recap_row_fingerprint is null)
  )
);
create index if not exists logistics_lines_org_idx
  on public.logistics_lines (organization_id);
create index if not exists logistics_lines_stage_idx
  on public.logistics_lines (stage);
create index if not exists logistics_lines_customer_idx
  on public.logistics_lines (customer_label);
create unique index if not exists logistics_lines_recap_row_key
  on public.logistics_lines (source_id, recap_row_id)
  where recap_row_id is not null;

-- Table 4/13 — succession des événements (réponse Q2 : Argenteuil PUIS
-- Aubagne = un transfert, jamais une double disponibilité).
create table if not exists public.logistics_line_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  logistics_line_id uuid not null
    references public.logistics_lines(id) on delete cascade,
  event_type text not null check (event_type in (
    'commande_fournisseur','arrivee_prevue','reception_argenteuil',
    'depart_transfert','reception_aubagne','mise_a_disposition','sortie',
    'correction'
  )),
  warehouse_id uuid references public.warehouses(id),
  occurred_on date not null,
  quantity integer check (quantity > 0),
  source text not null default 'recap' check (source in ('recap', 'manuel')),
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  notes text
);
create index if not exists logistics_line_events_line_idx
  on public.logistics_line_events (logistics_line_id, occurred_on);

-- ===========================================================================
-- 3. DOSSIERS DE LIVRAISON ET AFFECTATIONS (tables 5-6)
-- ===========================================================================

-- Table 5/13 — les MONTANTS n'y figurent pas : ils sont recomposés à la
-- lecture depuis l'extraction et ses corrections (décision E16).
create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reference text not null,
  skara_order_reference text,           -- référence de COMMANDE Skara
  skara_document_reference text,        -- n° de FACTURE / document
  customer_id uuid references public.customers(id),
  customer_name text,
  customer_phone text,
  customer_email text,
  address_line text,
  postal_code text,
  city text,
  access_notes text,
  store_id uuid references public.stores(id),
  origin_warehouse_id uuid references public.warehouses(id),
  remise_type text check (remise_type in (
    'retrait_magasin','retrait_depot','livraison_pied_immeuble',
    'livraison_piece','livraison_installation'
  )),
  stage text not null default 'a_rapprocher' check (stage in (
    'a_rapprocher','incomplet','pret_a_contacter','contact_en_cours',
    'creneau_confirme','planifie','en_cours','termine','clos','annule'
  )),
  expected_ready_at date,
  priority integer not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference)
);
create index if not exists delivery_jobs_org_stage_idx
  on public.delivery_jobs (organization_id, stage);
create index if not exists delivery_jobs_skara_order_idx
  on public.delivery_jobs (organization_id, skara_order_reference);

-- Table 6/13 — affectation d'une quantité d'une ligne à un DOSSIER.
-- Aucune référence vers une table future (pas de delivery_visit_id) : les
-- passages multiples seront modélisés en phase 5 par une table reliant une
-- affectation existante à un passage.
create table if not exists public.delivery_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  logistics_line_id uuid not null
    references public.logistics_lines(id) on delete cascade,
  delivery_job_id uuid not null
    references public.delivery_jobs(id) on delete cascade,
  quantity_allocated integer not null check (quantity_allocated > 0),
  quantity_delivered integer not null default 0 check (quantity_delivered >= 0),
  status text not null default 'prevue' check (status in (
    'prevue','preparee','livree','refusee','reportee','annulee'
  )),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_allocations_delivered_check
    check (quantity_delivered <= quantity_allocated)
);
-- Unicité au niveau DOSSIER, hors affectations annulées (réaffectation
-- possible après annulation).
create unique index if not exists delivery_allocations_line_job_key
  on public.delivery_allocations (logistics_line_id, delivery_job_id)
  where status <> 'annulee';
create index if not exists delivery_allocations_job_idx
  on public.delivery_allocations (delivery_job_id);

-- ===========================================================================
-- 4. DOCUMENTS SKARA (tables 7-9)
-- ===========================================================================

-- Table 7/13
create table if not exists public.skara_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  storage_path text not null,           -- bucket PRIVÉ
  file_name text not null,
  file_hash text not null,
  page_count integer check (page_count > 0),
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  extraction_status text not null default 'en_attente' check (extraction_status in (
    'en_attente','extrait','echec','verifie'
  )),
  delivery_job_id uuid references public.delivery_jobs(id),
  -- Anti-doublon PAR ORGANISATION.
  unique (organization_id, file_hash)
);

-- Table 8/13 — valeurs BRUTES, jamais modifiées (aucun droit d'update ;
-- politique de blocage explicite plus bas).
create table if not exists public.skara_document_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  -- `restrict` : une extraction ne peut pas être effacée, même par cascade
  -- (immuabilité garantie par déclencheur, §10 bis).
  document_id uuid not null references public.skara_documents(id) on delete restrict,
  method text not null default 'gabarit' check (method in ('gabarit')),
  template_version text,
  extracted_at timestamptz not null default now(),
  raw_text_hash text,
  skara_order_reference text,
  skara_document_reference text,
  document_date date,
  store_label text,
  advisor_label text,
  customer_name text,
  customer_phone text,
  customer_email text,
  address_line text,
  postal_code text,
  city text,
  remise_type_label text,
  remise_address text,
  remise_date date,
  lines jsonb not null default '[]'::jsonb,
  amount_total_cents integer,
  amount_paid_cents integer,
  amount_due_cents integer,
  amount_to_collect_cents integer,
  field_confidence jsonb not null default '{}'::jsonb
);
create index if not exists skara_extractions_document_idx
  on public.skara_document_extractions (document_id);

-- Table 9/13 — corrections humaines, append-only. La valeur brute est
-- recopiée pour retrouver l'état initial même après plusieurs corrections.
create table if not exists public.skara_document_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  -- `restrict` et non `cascade` : ces lignes sont protégées contre toute
  -- suppression (§10 bis). Une cascade échouerait de toute façon sur le
  -- déclencheur d'immuabilité ; `restrict` donne un message clair.
  document_id uuid not null references public.skara_documents(id) on delete restrict,
  extraction_id uuid not null
    references public.skara_document_extractions(id) on delete restrict,
  field_name text not null,
  raw_value text,
  corrected_value text,
  -- Motif OBLIGATOIRE : ni nul, ni vide, ni composé d'espaces.
  reason text not null constraint skara_corrections_reason_check
    check (btrim(reason) <> ''),
  corrected_by uuid not null references public.profiles(id),
  corrected_at timestamptz not null default now()
);
create index if not exists skara_corrections_extraction_idx
  on public.skara_document_corrections (extraction_id, field_name, corrected_at desc);

-- ===========================================================================
-- 5. RAPPROCHEMENT ET ANOMALIES (tables 10-11)
-- ===========================================================================

-- Table 10/13 — VRAIES clés étrangères (plus de référence polymorphe) :
-- exactement un sujet et exactement une cible.
create table if not exists public.match_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  subject_document_id uuid references public.skara_documents(id) on delete cascade,
  subject_line_id uuid references public.logistics_lines(id) on delete cascade,
  target_job_id uuid references public.delivery_jobs(id) on delete cascade,
  target_line_id uuid references public.logistics_lines(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  criteria jsonb not null default '{}'::jsonb,
  status text not null default 'propose' check (status in (
    'propose','confirme','rejete','expire'
  )),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint match_candidates_subject_check check (
    (subject_document_id is not null)::int + (subject_line_id is not null)::int = 1
  ),
  constraint match_candidates_target_check check (
    (target_job_id is not null)::int + (target_line_id is not null)::int = 1
  )
);
create index if not exists match_candidates_status_idx
  on public.match_candidates (organization_id, status);

-- Table 11/13 — anomalies SÉPARÉES des statuts (correction F).
create table if not exists public.logistics_anomalies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  recap_read_id uuid references public.recap_reads(id) on delete cascade,
  logistics_line_id uuid references public.logistics_lines(id) on delete cascade,
  document_id uuid references public.skara_documents(id) on delete cascade,
  delivery_job_id uuid references public.delivery_jobs(id) on delete cascade,
  type text not null,
  severity text not null default 'avertissement'
    check (severity in ('info','avertissement','bloquant')),
  message text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text,
  constraint logistics_anomalies_scope_check check (
    (recap_read_id is not null)::int
    + (logistics_line_id is not null)::int
    + (document_id is not null)::int
    + (delivery_job_id is not null)::int = 1
  )
);
create index if not exists logistics_anomalies_open_idx
  on public.logistics_anomalies (organization_id, severity)
  where resolved_at is null;

-- ===========================================================================
-- 6. JOURNAUX TECHNIQUES (tables 12-13)
-- ===========================================================================

-- Table 12/13 — même patron que shopify_webhook_events (déjà éprouvé).
-- `payload` ne doit jamais contenir de donnée personnelle.
create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source text not null check (source in ('google_sheet','pdf_upload','manuel')),
  event_type text not null,
  external_ref text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'recu' check (status in ('recu','traite','erreur','ignore')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Table 13/13 — journal des consultations sensibles : QUI a consulté QUOI et
-- QUAND. Ne contient JAMAIS la valeur consultée.
create table if not exists public.sensitive_access_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  action text not null check (action in (
    'consultation_coordonnees','consultation_montants',
    'consultation_document','telechargement_document'
  )),
  object_type text not null,
  object_id uuid,
  context text,
  occurred_at timestamptz not null default now()
);
create index if not exists sensitive_access_logs_profile_idx
  on public.sensitive_access_logs (organization_id, profile_id, occurred_at desc);

-- ===========================================================================
-- 7. COLONNES AJOUTÉES AUX TABLES EXISTANTES (toutes optionnelles)
-- ===========================================================================

-- Référentiel logistique du catalogue (décision E5/E6). `dimensions` reste le
-- libellé commercial ; ces champs sont les dimensions EMBALLÉES.
alter table public.product_variants
  add column if not exists weight_grams integer,
  add column if not exists packed_length_mm integer,
  add column if not exists packed_width_mm integer,
  add column if not exists packed_height_mm integer,
  add column if not exists volume_cm3 integer,
  add column if not exists package_count integer,
  add column if not exists fragile boolean,
  add column if not exists requires_installation boolean,
  add column if not exists recommended_handlers integer,
  add column if not exists handling_notes text,
  add column if not exists logistics_verified_at timestamptz,
  add column if not exists logistics_verified_by uuid references public.profiles(id);

do $$
begin
  alter table public.product_variants
    add constraint product_variants_logistics_check check (
      (weight_grams is null or weight_grams between 1 and 2000000)
      and (packed_length_mm is null or packed_length_mm between 1 and 10000)
      and (packed_width_mm is null or packed_width_mm between 1 and 10000)
      and (packed_height_mm is null or packed_height_mm between 1 and 10000)
      and (volume_cm3 is null or volume_cm3 between 1 and 100000000)
      and (package_count is null or package_count between 1 and 50)
      and (recommended_handlers is null or recommended_handlers between 1 and 4)
    );
exception
  when duplicate_object then null;   -- rejouabilité
end $$;

alter table public.stores
  add column if not exists address_line text,
  add column if not exists postal_code text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists opening_notes text;

alter table public.warehouses
  add column if not exists address_line text,
  add column if not exists postal_code text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists opening_notes text;

-- ===========================================================================
-- 8. RÔLES (7 + 2 = 9) ET PERMISSIONS (11 + 7 = 18)
-- ===========================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in (
    'vendeur','responsable_magasin','achats','logistique','comptabilite',
    'direction','administrateur',
    'responsable_logistique','livreur'
  ));

-- Matrice mise à jour. Le rôle « livreur » ne reçoit AUCUNE permission en
-- phase 1 (décision E18) : ses droits seront ouverts en phase 6, en même
-- temps que la relation livreur ↔ passage et les tests RLS correspondants.
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

-- ===========================================================================
-- 9. DÉCLENCHEURS updated_at
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'recap_sources','logistics_lines','delivery_jobs','delivery_allocations'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

-- ===========================================================================
-- 10. RLS + RÉVOCATION TOTALE DES DROITS DIRECTS (décision E15)
-- ---------------------------------------------------------------------------
-- Supabase accorde automatiquement les droits aux rôles anon/authenticated à
-- la création d'une table (default privileges). On les retire ici : plus
-- aucune lecture ni écriture directe via l'API, même pour un administrateur.
-- La RLS reste activée en défense en profondeur.
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'recap_sources','recap_reads','logistics_lines','logistics_line_events',
    'delivery_jobs','delivery_allocations','skara_documents',
    'skara_document_extractions','skara_document_corrections',
    'match_candidates','logistics_anomalies','sync_events',
    'sensitive_access_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    -- Politique unique et explicite : aucun accès direct, quelle que soit la
    -- session. Les fonctions security definer ne sont pas concernées.
    execute format('drop policy if exists %I on public.%I',
                   t || '_no_direct_access', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (false) with check (false)',
      t || '_no_direct_access', t);
  end loop;
end $$;

-- Aucune écriture directe du navigateur sur le référentiel produit : les
-- champs logistiques passent par set_variant_logistics. La synchronisation
-- Shopify utilise la clé serveur (rôle service_role) et n'est pas affectée.
revoke update on public.product_variants from authenticated;
revoke update on public.product_variants from anon;

-- Skara reste la source de création des commandes : la fonction de création
-- de commande magasin n'est plus exécutable depuis l'application. Le code et
-- les données existantes sont conservés (le retour arrière la rétablit).
revoke execute on function public.create_store_order(jsonb) from authenticated;
revoke execute on function public.create_store_order(jsonb) from anon;
revoke execute on function public.create_store_order(jsonb) from public;

-- ===========================================================================
-- 10 bis. IMMUABILITÉ RÉELLE (résiste à la clé serveur)
-- ---------------------------------------------------------------------------
-- Révoquer les droits d'`anon` et `authenticated` ne suffit pas : les
-- écritures d'ingestion (phases 2-3) utiliseront la clé serveur, dont le rôle
-- `service_role` contourne la RLS et possède ses propres droits. Un
-- DÉCLENCHEUR, lui, s'applique à TOUTE écriture quel que soit le rôle —
-- y compris service_role et le propriétaire des tables.
--
--   * skara_document_extractions : IMMUABLE (ni update, ni delete) — une
--     nouvelle lecture crée une nouvelle extraction, elle n'écrase jamais
--     la valeur brute d'origine ;
--   * skara_document_corrections : APPEND-ONLY — une correction erronée se
--     corrige par une nouvelle correction, l'historique reste complet ;
--   * sensitive_access_logs     : APPEND-ONLY — un journal d'accès qui peut
--     être réécrit ne prouve rien.
-- ===========================================================================

create or replace function app.forbid_update_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'Table % : écriture en ajout seul — % interdit (donnée probante conservée telle quelle).',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'skara_document_extractions',
    'skara_document_corrections',
    'sensitive_access_logs'
  ]
  loop
    execute format('drop trigger if exists append_only_guard on public.%I', t);
    execute format(
      'create trigger append_only_guard
         before update or delete on public.%I
         for each row execute function app.forbid_update_delete()', t);
  end loop;
end $$;

-- ===========================================================================
-- 10 ter. COHÉRENCE INTERORGANISATION DES RÉFÉRENCES
-- ---------------------------------------------------------------------------
-- Une clé étrangère classique garantit que la ligne visée existe, pas
-- qu'elle appartient à la MÊME organisation. Sans ce contrôle, une écriture
-- avec la clé serveur pourrait rattacher un dossier de l'organisation A à un
-- document de l'organisation B.
--
-- Choix retenu : un DÉCLENCHEUR CENTRALISÉ plutôt que des clés étrangères
-- composites. Motif : `product_variants` ne porte pas d'organisation (elle
-- est sur `products`), une clé composite y imposerait une colonne redondante
-- et sa synchronisation. Le déclencheur couvre tous les cas, y compris
-- indirects, et s'applique à tous les rôles.
-- ===========================================================================

-- Organisation propriétaire d'un objet, quel que soit son type.
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
    else
      raise exception 'Type d''objet inconnu pour le contrôle d''organisation : %', p_kind;
  end case;
  return v_org;
end;
$$;

-- Déclencheur générique : arguments par paires « colonne, type d'objet ».
create or replace function app.assert_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid := nullif(v_row->>'organization_id', '')::uuid;
  v_col text;
  v_kind text;
  v_val uuid;
  v_other uuid;
  i integer := 0;
begin
  if v_org is null then
    raise exception 'Organisation manquante sur %.', tg_table_name
      using errcode = '23514';
  end if;
  while i < tg_nargs loop
    v_col := tg_argv[i];
    v_kind := tg_argv[i + 1];
    v_val := nullif(v_row->>v_col, '')::uuid;
    if v_val is not null then
      v_other := app.org_of(v_kind, v_val);
      if v_other is null then
        raise exception 'Référence % introuvable sur %.', v_col, tg_table_name
          using errcode = '23503';
      end if;
      if v_other <> v_org then
        raise exception
          'Référence interorganisation interdite : %.% pointe vers une autre organisation.',
          tg_table_name, v_col
          using errcode = '42501';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('recap_reads',
       array['source_id','recap_source','triggered_by_profile_id','profile']),
      ('logistics_lines',
       array['source_id','recap_source','supplier_id','supplier',
             'variant_id','variant','current_warehouse_id','warehouse',
             'destination_warehouse_id','warehouse','created_by','profile']),
      ('logistics_line_events',
       array['logistics_line_id','logistics_line','warehouse_id','warehouse',
             'recorded_by','profile']),
      ('delivery_jobs',
       array['customer_id','customer','store_id','store',
             'origin_warehouse_id','warehouse','created_by','profile']),
      ('delivery_allocations',
       array['logistics_line_id','logistics_line','delivery_job_id','delivery_job',
             'decided_by','profile']),
      ('skara_documents',
       array['uploaded_by','profile','delivery_job_id','delivery_job']),
      ('skara_document_extractions',
       array['document_id','document']),
      ('skara_document_corrections',
       array['document_id','document','extraction_id','extraction',
             'corrected_by','profile']),
      ('match_candidates',
       array['subject_document_id','document','subject_line_id','logistics_line',
             'target_job_id','delivery_job','target_line_id','logistics_line',
             'decided_by','profile']),
      ('logistics_anomalies',
       array['recap_read_id','recap_read','logistics_line_id','logistics_line',
             'document_id','document','delivery_job_id','delivery_job',
             'resolved_by','profile']),
      ('sensitive_access_logs',
       array['profile_id','profile'])
    ) as t(table_name, args)
  loop
    execute format('drop trigger if exists same_org_guard on public.%I', spec.table_name);
    execute format(
      'create trigger same_org_guard
         before insert or update on public.%I
         for each row execute function app.assert_same_org(%s)',
      spec.table_name,
      (select string_agg(quote_literal(a), ', ') from unnest(spec.args) as a));
  end loop;
end $$;

-- ===========================================================================
-- 11. FONCTIONS RPC
-- ---------------------------------------------------------------------------
-- Toutes appliquent la même discipline :
--   1. app.require_permission(...) — refus si profil absent/désactivé ;
--   2. organisation lue via app.current_org_id() (auth.uid()), JAMAIS reçue
--      du navigateur ;
--   3. vérification que chaque objet manipulé appartient à cette
--      organisation — refus explicite sinon (isolation interorganisation) ;
--   4. search_path = '' et références entièrement qualifiées.
-- ===========================================================================

-- --- 11.0 Dernière correction d'un champ (valeur entière) ------------------
-- Sélection DÉTERMINISTE : la correction la plus récente, départagée par id
-- lorsque deux corrections partagent le même horodatage. Une valeur non
-- entière (champ texte corrigé par erreur) est ignorée plutôt que de faire
-- échouer la lecture du dossier.
create or replace function app.last_correction_int(
  p_extraction_id uuid,
  p_field text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when c.corrected_value ~ '^-?[0-9]+$' then c.corrected_value::integer
         end
  from public.skara_document_corrections c
  where c.extraction_id = p_extraction_id
    and c.field_name = p_field
  order by c.corrected_at desc, c.id desc
  limit 1
$$;

-- --- 11.1 Synthèse logistique (aucune donnée personnelle) ------------------
create or replace function public.logistics_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not (app.has_permission('gerer_livraisons') or app.has_permission('gerer_logistique')) then
    raise exception 'Votre rôle ne permet pas de consulter le suivi logistique.'
      using errcode = '42501';
  end if;
  v_org := app.current_org_id();
  return jsonb_build_object(
    'lignes_total', (select count(*) from public.logistics_lines
                     where organization_id = v_org),
    'lignes_disponibles', (select count(*) from public.logistics_lines
                           where organization_id = v_org and stage = 'disponible'),
    'dossiers_total', (select count(*) from public.delivery_jobs
                       where organization_id = v_org),
    'dossiers_a_contacter', (select count(*) from public.delivery_jobs
                             where organization_id = v_org and stage = 'pret_a_contacter'),
    'anomalies_ouvertes', (select count(*) from public.logistics_anomalies
                           where organization_id = v_org and resolved_at is null),
    'documents_a_verifier', (select count(*) from public.skara_documents
                             where organization_id = v_org
                               and extraction_status in ('en_attente','echec'))
  );
end;
$$;

-- --- 11.2 Référentiel logistique du catalogue (décision E17) ---------------
--
-- Convention de mise à jour, explicite et sans surprise :
--   * clé ABSENTE du payload  → la valeur enregistrée est CONSERVÉE ;
--   * clé présente à `null`   → la valeur est EFFACÉE (vidage volontaire) ;
--   * clé présente à une valeur → validée strictement.
-- Un nombre décimal est REFUSÉ (jamais arrondi en silence).

create or replace function app.payload_int(
  p_payload jsonb,
  p_key text,
  p_min integer,
  p_max integer,
  p_label text
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_node jsonb := p_payload -> p_key;
  v_num numeric;
begin
  if v_node is null or jsonb_typeof(v_node) = 'null' then
    return null;                        -- effacement volontaire
  end if;
  if jsonb_typeof(v_node) <> 'number' then
    raise exception '% : valeur numérique attendue.', p_label;
  end if;
  v_num := v_node::text::numeric;
  if v_num <> trunc(v_num) then
    raise exception '% : nombre entier attendu (% refusé, aucun arrondi automatique).',
      p_label, v_num;
  end if;
  if v_num < p_min or v_num > p_max then
    raise exception '% : valeur hors limites (attendu entre % et %).',
      p_label, p_min, p_max;
  end if;
  return v_num::integer;
end;
$$;

create or replace function public.set_variant_logistics(
  p_variant_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_variant_org uuid;
  v_title text;
  v_len integer;
  v_wid integer;
  v_hei integer;
begin
  v_profile := app.require_permission('gerer_referentiel_logistique');
  v_org := app.current_org_id();

  -- ISOLATION : la variante doit appartenir à l'organisation de l'appelant.
  select p.organization_id, p.title into v_variant_org, v_title
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id;

  if v_variant_org is null then
    raise exception 'Variante introuvable.';
  end if;
  if v_variant_org <> v_org then
    raise exception 'Accès refusé : cette variante appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  -- Validation AVANT toute écriture : en cas de refus, rien n'est modifié.
  perform app.payload_int(p_payload, 'weight_grams', 1, 2000000, 'Poids (g)');
  perform app.payload_int(p_payload, 'packed_length_mm', 1, 10000, 'Longueur emballée (mm)');
  perform app.payload_int(p_payload, 'packed_width_mm', 1, 10000, 'Largeur emballée (mm)');
  perform app.payload_int(p_payload, 'packed_height_mm', 1, 10000, 'Hauteur emballée (mm)');
  perform app.payload_int(p_payload, 'package_count', 1, 50, 'Nombre de colis');
  perform app.payload_int(p_payload, 'recommended_handlers', 1, 4, 'Livreurs conseillés');
  perform app.payload_int(p_payload, 'volume_cm3', 1, 100000000, 'Volume (cm³)');
  if p_payload ? 'fragile' and jsonb_typeof(p_payload->'fragile') not in ('boolean','null') then
    raise exception 'Fragile : valeur vrai/faux attendue.';
  end if;
  if p_payload ? 'requires_installation'
     and jsonb_typeof(p_payload->'requires_installation') not in ('boolean','null') then
    raise exception 'Installation : valeur vrai/faux attendue.';
  end if;

  update public.product_variants
  set weight_grams = case when p_payload ? 'weight_grams'
        then app.payload_int(p_payload, 'weight_grams', 1, 2000000, 'Poids (g)')
        else weight_grams end,
      packed_length_mm = case when p_payload ? 'packed_length_mm'
        then app.payload_int(p_payload, 'packed_length_mm', 1, 10000, 'Longueur emballée (mm)')
        else packed_length_mm end,
      packed_width_mm = case when p_payload ? 'packed_width_mm'
        then app.payload_int(p_payload, 'packed_width_mm', 1, 10000, 'Largeur emballée (mm)')
        else packed_width_mm end,
      packed_height_mm = case when p_payload ? 'packed_height_mm'
        then app.payload_int(p_payload, 'packed_height_mm', 1, 10000, 'Hauteur emballée (mm)')
        else packed_height_mm end,
      package_count = case when p_payload ? 'package_count'
        then app.payload_int(p_payload, 'package_count', 1, 50, 'Nombre de colis')
        else package_count end,
      recommended_handlers = case when p_payload ? 'recommended_handlers'
        then app.payload_int(p_payload, 'recommended_handlers', 1, 4, 'Livreurs conseillés')
        else recommended_handlers end,
      volume_cm3 = case when p_payload ? 'volume_cm3'
        then app.payload_int(p_payload, 'volume_cm3', 1, 100000000, 'Volume (cm³)')
        else volume_cm3 end,
      fragile = case when p_payload ? 'fragile'
        then nullif(p_payload->>'fragile', '')::boolean else fragile end,
      requires_installation = case when p_payload ? 'requires_installation'
        then nullif(p_payload->>'requires_installation', '')::boolean
        else requires_installation end,
      handling_notes = case when p_payload ? 'handling_notes'
        then nullif(btrim(coalesce(p_payload->>'handling_notes', '')), '')
        else handling_notes end,
      logistics_verified_at = now(),
      logistics_verified_by = v_profile
  where id = p_variant_id;

  -- Volume DÉRIVÉ des dimensions finales : recalculé quand les trois sont
  -- connues, effacé si l'une d'elles a été vidée — sauf si l'appelant a
  -- explicitement fourni un volume.
  if not (p_payload ? 'volume_cm3') then
    select packed_length_mm, packed_width_mm, packed_height_mm
    into v_len, v_wid, v_hei
    from public.product_variants where id = p_variant_id;

    update public.product_variants
    set volume_cm3 = case
          when v_len is not null and v_wid is not null and v_hei is not null
            then ((v_len::bigint * v_wid * v_hei) / 1000)::integer  -- mm³ → cm³
          else null
        end
    where id = p_variant_id;
  end if;

  perform app.log_activity(
    v_org,
    'Référentiel logistique mis à jour',
    v_title || ' — caractéristiques logistiques enregistrées.'
  );
end;
$$;

-- --- 11.3 Affectation atomique (protection 3 : suraffectation) -------------
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
declare
  v_profile uuid;
  v_org uuid;
  v_line public.logistics_lines%rowtype;
  v_job public.delivery_jobs%rowtype;
  v_already integer;
  v_existing uuid;
  v_id uuid;
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

-- --- 11.4 Lecture d'un dossier, colonnes sensibles filtrées ----------------
-- Sans « voir_coordonnees_client », le téléphone, l'e-mail et l'adresse
-- reviennent à null ; sans « voir_montants_livraison », les montants aussi.
-- Chaque consultation réellement servie est journalisée.
create or replace function public.get_delivery_job(p_delivery_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_job public.delivery_jobs%rowtype;
  v_can_contact boolean;
  v_can_amounts boolean;
  v_amounts jsonb := '{}'::jsonb;
begin
  v_profile := app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  select * into v_job from public.delivery_jobs where id = p_delivery_job_id;
  if not found then
    raise exception 'Dossier de livraison introuvable.';
  end if;
  -- ISOLATION : refus explicite interorganisation.
  if v_job.organization_id <> v_org then
    raise exception 'Accès refusé : ce dossier appartient à une autre organisation.'
      using errcode = '42501';
  end if;

  v_can_contact := app.has_permission('voir_coordonnees_client');
  v_can_amounts := app.has_permission('voir_montants_livraison');

  if v_can_contact then
    insert into public.sensitive_access_logs (
      organization_id, profile_id, action, object_type, object_id, context)
    values (v_org, v_profile, 'consultation_coordonnees',
            'delivery_job', v_job.id, 'get_delivery_job');
  end if;

  if v_can_amounts then
    -- Montants RECOMPOSÉS (décision E16) : valeur brute de l'extraction,
    -- remplacée par la DERNIÈRE correction du champ lorsqu'elle existe.
    --
    -- « Dernière » = ordre déterministe `corrected_at desc, id desc` :
    -- prendre le maximum de la VALEUR serait faux (une correction récente
    -- peut abaisser un montant), et deux corrections au même horodatage
    -- doivent être départagées de façon stable.
    select jsonb_build_object(
      'amount_total_cents',
        coalesce(app.last_correction_int(e.id, 'amount_total_cents'), e.amount_total_cents),
      'amount_paid_cents',
        coalesce(app.last_correction_int(e.id, 'amount_paid_cents'), e.amount_paid_cents),
      'amount_due_cents',
        coalesce(app.last_correction_int(e.id, 'amount_due_cents'), e.amount_due_cents),
      'amount_to_collect_cents',
        coalesce(app.last_correction_int(e.id, 'amount_to_collect_cents'), e.amount_to_collect_cents)
    )
    into v_amounts
    from public.skara_documents d
    join public.skara_document_extractions e on e.document_id = d.id
    where d.delivery_job_id = v_job.id
    order by e.extracted_at desc, e.id desc
    limit 1;

    if v_amounts is null then v_amounts := '{}'::jsonb; end if;

    insert into public.sensitive_access_logs (
      organization_id, profile_id, action, object_type, object_id, context)
    values (v_org, v_profile, 'consultation_montants',
            'delivery_job', v_job.id, 'get_delivery_job');
  end if;

  return jsonb_build_object(
    'id', v_job.id,
    'reference', v_job.reference,
    'skara_order_reference', v_job.skara_order_reference,
    'skara_document_reference', v_job.skara_document_reference,
    'customer_name', v_job.customer_name,
    'customer_phone', case when v_can_contact then v_job.customer_phone end,
    'customer_email', case when v_can_contact then v_job.customer_email end,
    'address_line',   case when v_can_contact then v_job.address_line end,
    'postal_code',    case when v_can_contact then v_job.postal_code end,
    'city',           case when v_can_contact then v_job.city end,
    'access_notes',   case when v_can_contact then v_job.access_notes end,
    'remise_type', v_job.remise_type,
    'stage', v_job.stage,
    'expected_ready_at', v_job.expected_ready_at,
    'montants', v_amounts
  );
end;
$$;

-- ===========================================================================
-- 12. DROITS D'EXÉCUTION DES RPC (protection 2)
-- ---------------------------------------------------------------------------
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : on le retire explicitement
-- pour PUBLIC et anon, puis on l'accorde au seul rôle authenticated.
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.logistics_summary()',
    'public.set_variant_logistics(uuid, jsonb)',
    'public.allocate_to_delivery_job(uuid, uuid, integer)',
    'public.get_delivery_job(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Fonctions INTERNES : elles ne sont appelées que depuis les RPC publiques
-- (security definer, donc avec les droits du propriétaire) et depuis les
-- déclencheurs (exécutés au nom du propriétaire de la table). Personne ne
-- doit pouvoir les appeler directement : `app.org_of` révélerait
-- l'existence d'objets d'autres organisations, et `app.payload_int` ou
-- `app.forbid_update_delete` n'ont aucun sens hors de leur contexte.
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.last_correction_int(uuid, text)',
    'app.org_of(text, uuid)',
    'app.payload_int(jsonb, text, integer, integer, text)',
    'app.forbid_update_delete()',
    'app.assert_same_org()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
  end loop;
end $$;

commit;
