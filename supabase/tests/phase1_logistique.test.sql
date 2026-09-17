-- ===========================================================================
-- TRUST AI — Tests de sécurité du SOCLE LOGISTIQUE (phase 1)
--
-- Prouve les quatre protections exigées avant implémentation :
--   1. isolation entre organisations dans TOUTES les RPC ;
--   2. droits d'exécution : aucun accès anonyme ;
--   3. impossibilité de suraffecter une quantité (verrou + recalcul) ;
--   4. aucune lecture directe des 13 tables, même pour un administrateur.
--
-- Exécution locale : migrations + seed appliqués, schéma auth présent (réel
-- sur Supabase, stub en local). Chaque assertion lève une exception si elle
-- échoue. Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Jeu d'essai : DEUX organisations distinctes
-- ---------------------------------------------------------------------------
-- Organisation A = celle du seed. Organisation B = créée pour les tests
-- d'isolation. Un administrateur de chaque côté.
insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000001', 'Organisation B (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-a000-000000000001', 'admin.a@test.local'),
  ('a1000000-0000-4000-a000-000000000002', 'resplog.a@test.local'),
  ('a1000000-0000-4000-a000-000000000003', 'livreur.a@test.local'),
  ('a1000000-0000-4000-a000-000000000004', 'vendeuse.a@test.local'),
  ('a1000000-0000-4000-a000-000000000005', 'logistique.a@test.local'),
  ('b1000000-0000-4000-b000-000000000001', 'admin.b@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('a1000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Admin A', 'administrateur'),
  ('a1000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Resp. log. A', 'responsable_logistique'),
  ('a1000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'Livreur A', 'livreur'),
  ('a1000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', 'Vendeuse A', 'vendeur'),
  ('a1000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001', 'Logisticien A', 'logistique'),
  ('b1000000-0000-4000-b000-000000000001', 'b0000000-0000-4000-b000-000000000001', 'Admin B', 'administrateur');

-- Données logistiques de l'organisation B (celles que A ne doit jamais voir).
insert into public.logistics_lines (
  id, organization_id, origin, origin_reason, designation, quantity, stage)
values ('b2000000-0000-4000-b000-000000000001',
        'b0000000-0000-4000-b000-000000000001', 'stock_local',
        'Article B en stock', 'Canapé B', 5, 'disponible');

insert into public.delivery_jobs (
  id, organization_id, reference, customer_name, customer_phone, address_line, city)
values ('b3000000-0000-4000-b000-000000000001',
        'b0000000-0000-4000-b000-000000000001', 'LIV-B-0001',
        'Client B', '0600000000', '1 rue B', 'Ville B');

-- Données de l'organisation A.
insert into public.logistics_lines (
  id, organization_id, origin, origin_reason, designation, quantity, stage)
values ('a2000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001', 'stock_local',
        'Disponible au dépôt', 'Canapé EVA XL', 4, 'disponible');

insert into public.delivery_jobs (
  id, organization_id, reference, customer_name, customer_phone,
  customer_email, address_line, postal_code, city)
values ('a3000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001', 'LIV-A-0001',
        'Client A', '0611111111', 'client.a@exemple.fr',
        '2 rue A', '91090', 'Lisses');

-- Variante de l'organisation B pour tester set_variant_logistics.
insert into public.products (id, organization_id, title, category, source)
values ('b4000000-0000-4000-b000-000000000001',
        'b0000000-0000-4000-b000-000000000001', 'Produit B', 'canapes', 'manuel');
insert into public.product_variants (id, product_id, name, sku, price_cents)
values ('b5000000-0000-4000-b000-000000000001',
        'b4000000-0000-4000-b000-000000000001', 'Standard', 'B-SKU-1', 10000);

-- ===========================================================================
-- TEST 1 — Aucune lecture directe des 13 tables, même pour un administrateur
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000001'; -- admin A

do $$
declare
  t text;
  v_ok boolean;
  v_echecs text := '';
begin
  foreach t in array array[
    'recap_sources','recap_reads','logistics_lines','logistics_line_events',
    'delivery_jobs','delivery_allocations','skara_documents',
    'skara_document_extractions','skara_document_corrections',
    'match_candidates','logistics_anomalies','sync_events',
    'sensitive_access_logs'
  ]
  loop
    v_ok := false;
    begin
      execute format('select 1 from public.%I limit 1', t);
    exception
      when insufficient_privilege then v_ok := true;   -- comportement attendu
    end;
    if not v_ok then
      v_echecs := v_echecs || t || ' ';
    end if;
  end loop;
  if v_echecs <> '' then
    raise exception 'ECHEC : lecture directe possible sur : %', v_echecs;
  end if;
  raise notice 'TEST 1 OK — aucune lecture directe des 13 tables (même administrateur)';
end $$;

-- Écriture directe également refusée.
do $$
begin
  begin
    execute 'insert into public.delivery_jobs (organization_id, reference)
             values (''00000000-0000-4000-a000-000000000001'', ''PIRATE'')';
    raise exception 'ECHEC : insertion directe acceptée';
  exception
    when insufficient_privilege then
      raise notice 'TEST 1b OK — écriture directe refusée';
  end;
end $$;
reset role;

-- ===========================================================================
-- TEST 2 — Isolation interorganisation dans les RPC
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000001'; -- admin A

-- 2a. Lecture d'un dossier de l'organisation B avec son identifiant exact.
do $$
begin
  perform public.get_delivery_job('b3000000-0000-4000-b000-000000000001');
  raise exception 'ECHEC : admin A a pu lire un dossier de l''organisation B';
exception
  when insufficient_privilege then
    raise notice 'TEST 2a OK — lecture interorganisation refusée (dossier B)';
end $$;

-- 2b. Affectation d'une ligne B vers un dossier B.
do $$
begin
  perform public.allocate_to_delivery_job(
    'b2000000-0000-4000-b000-000000000001',
    'b3000000-0000-4000-b000-000000000001', 1);
  raise exception 'ECHEC : admin A a pu affecter des données de l''organisation B';
exception
  when insufficient_privilege then
    raise notice 'TEST 2b OK — affectation interorganisation refusée';
end $$;

-- 2c. Mélange : ligne de A vers un dossier de B (tentative de fuite croisée).
do $$
begin
  perform public.allocate_to_delivery_job(
    'a2000000-0000-4000-a000-000000000001',
    'b3000000-0000-4000-b000-000000000001', 1);
  raise exception 'ECHEC : affectation croisée A→B acceptée';
exception
  when insufficient_privilege then
    raise notice 'TEST 2c OK — affectation croisée A→B refusée';
end $$;

-- 2d. Modification du référentiel d'une variante de l'organisation B.
do $$
begin
  perform public.set_variant_logistics(
    'b5000000-0000-4000-b000-000000000001',
    '{"weight_grams": 1000}'::jsonb);
  raise exception 'ECHEC : admin A a pu modifier une variante de l''organisation B';
exception
  when insufficient_privilege then
    raise notice 'TEST 2d OK — modification interorganisation refusée (variante B)';
end $$;

-- 2e. Le résumé ne compte QUE les données de l'organisation de l'appelant.
do $$
declare v jsonb;
begin
  v := public.logistics_summary();
  if (v->>'lignes_total')::int <> 1 then
    raise exception 'ECHEC : le résumé de A voit % lignes au lieu de 1', v->>'lignes_total';
  end if;
  if (v->>'dossiers_total')::int <> 1 then
    raise exception 'ECHEC : le résumé de A voit % dossiers au lieu de 1', v->>'dossiers_total';
  end if;
  raise notice 'TEST 2e OK — le résumé est cloisonné par organisation';
end $$;

-- 2f. Symétrie : l'administrateur B ne voit pas les données de A.
set local "request.jwt.claim.sub" = 'b1000000-0000-4000-b000-000000000001'; -- admin B
do $$
begin
  perform public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  raise exception 'ECHEC : admin B a pu lire un dossier de l''organisation A';
exception
  when insufficient_privilege then
    raise notice 'TEST 2f OK — isolation symétrique (B ne lit pas A)';
end $$;
reset role;

-- ===========================================================================
-- TEST 3 — Droits d'exécution : aucun accès anonyme
-- ===========================================================================
set role anon;
do $$
declare
  f text;
  v_ok boolean;
  v_echecs text := '';
begin
  foreach f in array array[
    'select public.logistics_summary()',
    'select public.get_delivery_job(''a3000000-0000-4000-a000-000000000001'')',
    'select public.allocate_to_delivery_job(''a2000000-0000-4000-a000-000000000001'',''a3000000-0000-4000-a000-000000000001'',1)',
    'select public.set_variant_logistics(''b5000000-0000-4000-b000-000000000001'', ''{}''::jsonb)'
  ]
  loop
    v_ok := false;
    begin
      execute f;
    exception
      when insufficient_privilege then v_ok := true;   -- attendu
    end;
    if not v_ok then v_echecs := v_echecs || f || ' | '; end if;
  end loop;
  if v_echecs <> '' then
    raise exception 'ECHEC : un utilisateur anonyme a pu exécuter : %', v_echecs;
  end if;
  raise notice 'TEST 3 OK — aucune RPC logistique exécutable par un anonyme';
end $$;
reset role;

-- ===========================================================================
-- TEST 4 — Suraffectation impossible (verrou + recalcul dans la transaction)
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002'; -- resp. logistique A

-- Ligne A = 4 unités. Première affectation de 3 : acceptée.
do $$
declare v_id uuid;
begin
  v_id := public.allocate_to_delivery_job(
    'a2000000-0000-4000-a000-000000000001',
    'a3000000-0000-4000-a000-000000000001', 3);
  if v_id is null then raise exception 'ECHEC : première affectation refusée'; end if;
  raise notice 'TEST 4a OK — 3 unités affectées sur 4';
end $$;

-- Deuxième affectation de 2 : dépasserait 4 → refus.
do $$
begin
  perform public.allocate_to_delivery_job(
    'a2000000-0000-4000-a000-000000000001',
    'a3000000-0000-4000-a000-000000000001', 2);
  raise exception 'ECHEC : suraffectation acceptée (3 + 2 > 4)';
exception
  when raise_exception then
    raise notice 'TEST 4b OK — suraffectation refusée : %', sqlerrm;
end $$;

-- Le reliquat exact (1) reste affectable.
do $$
begin
  perform public.allocate_to_delivery_job(
    'a2000000-0000-4000-a000-000000000001',
    'a3000000-0000-4000-a000-000000000001', 1);
  raise notice 'TEST 4c OK — reliquat exact accepté (3 + 1 = 4)';
end $$;

-- Plus rien ne passe ensuite, même une seule unité.
do $$
begin
  perform public.allocate_to_delivery_job(
    'a2000000-0000-4000-a000-000000000001',
    'a3000000-0000-4000-a000-000000000001', 1);
  raise exception 'ECHEC : affectation au-delà de la quantité totale';
exception
  when raise_exception then
    raise notice 'TEST 4d OK — ligne saturée, aucune affectation supplémentaire';
end $$;

-- Contrôle final : la somme affectée n'excède jamais la quantité.
reset role;
do $$
declare v_sum integer; v_qty integer;
begin
  select coalesce(sum(quantity_allocated),0) into v_sum
  from public.delivery_allocations
  where logistics_line_id = 'a2000000-0000-4000-a000-000000000001'
    and status <> 'annulee';
  select quantity into v_qty from public.logistics_lines
  where id = 'a2000000-0000-4000-a000-000000000001';
  if v_sum > v_qty then
    raise exception 'ECHEC : % affectés pour une quantité de %', v_sum, v_qty;
  end if;
  raise notice 'TEST 4e OK — total affecté % ≤ quantité % (invariant respecté)', v_sum, v_qty;
end $$;

-- ===========================================================================
-- TEST 5 — Filtrage des colonnes sensibles selon la permission
-- ===========================================================================
set role authenticated;

-- 5a. Responsable logistique : coordonnées ET montants visibles, consultation
--     journalisée.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v jsonb;
begin
  v := public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  if v->>'customer_phone' is null then
    raise exception 'ECHEC : le responsable logistique devrait voir le téléphone';
  end if;
  if v->>'customer_email' is null or v->>'address_line' is null then
    raise exception 'ECHEC : coordonnées incomplètes pour un profil autorisé';
  end if;
  raise notice 'TEST 5a OK — coordonnées servies au profil autorisé';
end $$;

-- Le journal ne peut PAS être lu depuis une session utilisateur (droits
-- révoqués) : la vérification se fait donc hors session, ce qui prouve à la
-- fois l'écriture du journal et son inaccessibilité directe.
reset role;
do $$
declare v_logs integer;
begin
  select count(*) into v_logs from public.sensitive_access_logs
  where profile_id = 'a1000000-0000-4000-a000-000000000002'
    and action in ('consultation_coordonnees','consultation_montants');
  if v_logs < 2 then
    raise exception 'ECHEC : consultation sensible non journalisée (% ligne(s))', v_logs;
  end if;
  raise notice 'TEST 5a-bis OK — consultation journalisée (% entrées)', v_logs;
end $$;
set role authenticated;

-- 5b. Un profil sans « voir_coordonnees_client » ni « voir_montants_livraison »
--     obtient des valeurs nulles, sans erreur.
--     Le rôle « logistique » détient gerer_livraisons et
--     voir_coordonnees_client, mais PAS voir_montants_livraison.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000005';
do $$
declare v jsonb;
begin
  v := public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  -- Le rôle « logistique » voit les coordonnées mais PAS les montants.
  if v->>'customer_phone' is null then
    raise exception 'ECHEC : le rôle logistique devrait voir les coordonnées';
  end if;
  if v->'montants' <> '{}'::jsonb then
    raise exception 'ECHEC : montants servis sans la permission (%)', v->'montants';
  end if;
  raise notice 'TEST 5b OK — montants masqués sans « voir_montants_livraison »';
end $$;

-- 5c. Le LIVREUR n'a aucune permission en phase 1 : accès refusé partout.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000003';
do $$
begin
  perform public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  raise exception 'ECHEC : le livreur a pu lire un dossier en phase 1';
exception
  when insufficient_privilege then
    raise notice 'TEST 5c OK — livreur sans aucun accès (phase 1)';
end $$;

-- 5d. Une vendeuse ne peut pas non plus toucher au module logistique.
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000004';
do $$
begin
  perform public.logistics_summary();
  raise exception 'ECHEC : une vendeuse a pu consulter le suivi logistique';
exception
  when insufficient_privilege then
    raise notice 'TEST 5d OK — vendeuse sans accès logistique';
end $$;
reset role;

-- ===========================================================================
-- TEST 6 — Référentiel logistique : validation et isolation
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';

do $$
declare v_variant uuid;
begin
  select v.id into v_variant
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where p.organization_id = '00000000-0000-4000-a000-000000000001'
  limit 1;

  -- Valeur aberrante refusée.
  begin
    perform public.set_variant_logistics(v_variant, '{"recommended_handlers": 9}'::jsonb);
    raise exception 'ECHEC : 9 livreurs acceptés';
  exception when raise_exception then null;
  end;

  begin
    perform public.set_variant_logistics(v_variant, '{"weight_grams": -5}'::jsonb);
    raise exception 'ECHEC : poids négatif accepté';
  exception when raise_exception then null;
  end;

  -- Valeurs correctes acceptées, volume calculé depuis les dimensions.
  perform public.set_variant_logistics(v_variant, jsonb_build_object(
    'weight_grams', 45000,
    'packed_length_mm', 2500,
    'packed_width_mm', 1000,
    'packed_height_mm', 800,
    'package_count', 2,
    'fragile', true,
    'requires_installation', true,
    'recommended_handlers', 2));

  if (select volume_cm3 from public.product_variants where id = v_variant)
     <> ((2500::bigint * 1000 * 800) / 1000)::integer then
    raise exception 'ECHEC : volume mal calculé';
  end if;
  raise notice 'TEST 6 OK — validation des valeurs et volume calculé';
end $$;
reset role;

-- ===========================================================================
-- TEST 7 — Contraintes d'intégrité du modèle
-- ===========================================================================
do $$
begin
  -- Origine « recap » sans rattachement au fichier : refus.
  begin
    insert into public.logistics_lines (organization_id, origin, designation, quantity)
    values ('00000000-0000-4000-a000-000000000001', 'recap', 'Sans source', 1);
    raise exception 'ECHEC : ligne « recap » sans source acceptée';
  exception when check_violation then null;
  end;

  -- Origine « stock_local » sans motif : refus.
  begin
    insert into public.logistics_lines (organization_id, origin, designation, quantity)
    values ('00000000-0000-4000-a000-000000000001', 'stock_local', 'Sans motif', 1);
    raise exception 'ECHEC : ligne « stock_local » sans motif acceptée';
  exception when check_violation then null;
  end;

  -- Anomalie rattachée à deux objets : refus (plus de polymorphisme).
  begin
    insert into public.logistics_anomalies (
      organization_id, logistics_line_id, delivery_job_id, type, message)
    values ('00000000-0000-4000-a000-000000000001',
            'a2000000-0000-4000-a000-000000000001',
            'a3000000-0000-4000-a000-000000000001', 'test', 'double rattachement');
    raise exception 'ECHEC : anomalie à double rattachement acceptée';
  exception when check_violation then null;
  end;

  -- Rapprochement sans sujet : refus.
  begin
    insert into public.match_candidates (organization_id, target_job_id, score)
    values ('00000000-0000-4000-a000-000000000001',
            'a3000000-0000-4000-a000-000000000001', 80);
    raise exception 'ECHEC : rapprochement sans sujet accepté';
  exception when check_violation then null;
  end;

  raise notice 'TEST 7 OK — contraintes d''intégrité respectées';
end $$;

-- ===========================================================================
-- TEST 8 — Les profils existants restent valides après élargissement du rôle
-- ===========================================================================
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.profiles
  where role not in ('vendeur','responsable_magasin','achats','logistique',
                     'comptabilite','direction','administrateur',
                     'responsable_logistique','livreur');
  if v_count > 0 then
    raise exception 'ECHEC : % profil(s) au rôle invalide', v_count;
  end if;
  raise notice 'TEST 8 OK — tous les profils restent valides (9 rôles acceptés)';
end $$;

-- ===========================================================================
-- TEST 9 — Montants : la DERNIÈRE correction gagne, pas la plus grande
-- ---------------------------------------------------------------------------
-- Cas piège demandé par l'audit : la correction la plus récente porte une
-- valeur INFÉRIEURE à une correction antérieure. Un `max()` renverrait la
-- mauvaise valeur.
-- ===========================================================================
insert into public.skara_documents (
  id, organization_id, storage_path, file_name, file_hash, delivery_job_id)
values ('a6000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        'documents-skara/test.pdf', 'facture-test.pdf', 'hash-test-1',
        'a3000000-0000-4000-a000-000000000001');

insert into public.skara_document_extractions (
  id, organization_id, document_id, amount_total_cents, amount_paid_cents,
  amount_due_cents, amount_to_collect_cents)
values ('a7000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        'a6000000-0000-4000-a000-000000000001',
        250000, 100000, 150000, 150000);

-- Correction 1 (ANCIENNE) : valeur ÉLEVÉE. Correction 2 (RÉCENTE) : plus
-- basse. La lecture doit retenir 180000, pas 990000.
insert into public.skara_document_corrections (
  organization_id, document_id, extraction_id, field_name,
  raw_value, corrected_value, reason, corrected_by, corrected_at)
values
  ('00000000-0000-4000-a000-000000000001',
   'a6000000-0000-4000-a000-000000000001', 'a7000000-0000-4000-a000-000000000001',
   'amount_total_cents', '250000', '990000', 'Première lecture erronée',
   'a1000000-0000-4000-a000-000000000002', '2026-08-18 10:00:00+00'),
  ('00000000-0000-4000-a000-000000000001',
   'a6000000-0000-4000-a000-000000000001', 'a7000000-0000-4000-a000-000000000001',
   'amount_total_cents', '990000', '180000', 'Correction définitive après vérification',
   'a1000000-0000-4000-a000-000000000002', '2026-08-19 09:00:00+00');

set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v jsonb; v_total integer;
begin
  v := public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  v_total := (v->'montants'->>'amount_total_cents')::integer;
  if v_total = 990000 then
    raise exception 'ECHEC : la correction la PLUS GRANDE a été retenue (990000)';
  end if;
  if v_total <> 180000 then
    raise exception 'ECHEC : montant recomposé % au lieu de 180000', v_total;
  end if;
  -- Les champs sans correction gardent la valeur brute de l'extraction.
  if (v->'montants'->>'amount_paid_cents')::integer <> 100000 then
    raise exception 'ECHEC : valeur brute non conservée pour un champ non corrigé';
  end if;
  raise notice 'TEST 9 OK — dernière correction retenue (180000), brut conservé ailleurs';
end $$;

-- Départage par id lorsque l'horodatage est identique : la lecture doit
-- rester déterministe (aucune erreur, une seule valeur).
reset role;
insert into public.skara_document_corrections (
  organization_id, document_id, extraction_id, field_name,
  raw_value, corrected_value, reason, corrected_by, corrected_at)
values
  ('00000000-0000-4000-a000-000000000001',
   'a6000000-0000-4000-a000-000000000001', 'a7000000-0000-4000-a000-000000000001',
   'amount_due_cents', '150000', '111111', 'Ex aequo A',
   'a1000000-0000-4000-a000-000000000002', '2026-08-19 12:00:00+00'),
  ('00000000-0000-4000-a000-000000000001',
   'a6000000-0000-4000-a000-000000000001', 'a7000000-0000-4000-a000-000000000001',
   'amount_due_cents', '150000', '222222', 'Ex aequo B',
   'a1000000-0000-4000-a000-000000000002', '2026-08-19 12:00:00+00');

set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v1 jsonb; v2 jsonb;
begin
  v1 := public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  v2 := public.get_delivery_job('a3000000-0000-4000-a000-000000000001');
  if v1->'montants'->>'amount_due_cents' is distinct from v2->'montants'->>'amount_due_cents' then
    raise exception 'ECHEC : lecture non déterministe en cas d''ex aequo';
  end if;
  raise notice 'TEST 9b OK — départage déterministe en cas d''horodatage identique (%)',
    v1->'montants'->>'amount_due_cents';
end $$;
reset role;

-- ===========================================================================
-- TEST 10 — Immuabilité RÉELLE, y compris pour les écritures privilégiées
-- ---------------------------------------------------------------------------
-- Les phases 2-3 écriront avec la clé serveur (rôle `service_role`), qui
-- contourne la RLS. Les déclencheurs, eux, s'appliquent à tous les rôles.
-- ===========================================================================
do $$
begin
  -- Extraction : ni update, ni delete (rôle courant = superutilisateur).
  begin
    update public.skara_document_extractions set amount_total_cents = 1
    where id = 'a7000000-0000-4000-a000-000000000001';
    raise exception 'ECHEC : extraction modifiable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.skara_document_extractions
    where id = 'a7000000-0000-4000-a000-000000000001';
    raise exception 'ECHEC : extraction supprimable';
  exception when insufficient_privilege then null;
  end;

  -- Corrections : append-only.
  begin
    update public.skara_document_corrections set corrected_value = '1'
    where extraction_id = 'a7000000-0000-4000-a000-000000000001';
    raise exception 'ECHEC : correction modifiable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.skara_document_corrections
    where extraction_id = 'a7000000-0000-4000-a000-000000000001';
    raise exception 'ECHEC : correction supprimable';
  exception when insufficient_privilege then null;
  end;

  -- Journal des accès sensibles : append-only.
  begin
    update public.sensitive_access_logs set action = 'consultation_montants';
    raise exception 'ECHEC : journal d''accès modifiable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.sensitive_access_logs;
    raise exception 'ECHEC : journal d''accès supprimable';
  exception when insufficient_privilege then null;
  end;

  raise notice 'TEST 10 OK — extractions immuables, corrections et journal en ajout seul';
end $$;

-- Même refus sous le rôle service_role (celui de la clé serveur).
set role service_role;
do $$
begin
  begin
    update public.skara_document_extractions set amount_total_cents = 42
    where id = 'a7000000-0000-4000-a000-000000000001';
    raise exception 'ECHEC : service_role a modifié une extraction';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.skara_document_corrections
    where extraction_id = 'a7000000-0000-4000-a000-000000000001';
    raise exception 'ECHEC : service_role a supprimé une correction';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TEST 10b OK — la clé serveur (service_role) ne peut ni modifier ni supprimer';
end $$;
reset role;

-- Une suppression du document parent ne contourne pas la protection.
do $$
begin
  delete from public.skara_documents where id = 'a6000000-0000-4000-a000-000000000001';
  raise exception 'ECHEC : suppression du document acceptée malgré ses extractions';
exception
  when foreign_key_violation then
    raise notice 'TEST 10c OK — document non supprimable tant qu''il porte des extractions';
end $$;

-- ===========================================================================
-- TEST 11 — Motif de correction : ni nul, ni vide, ni espaces
-- ===========================================================================
do $$
begin
  begin
    insert into public.skara_document_corrections (
      organization_id, document_id, extraction_id, field_name,
      corrected_value, reason, corrected_by)
    values ('00000000-0000-4000-a000-000000000001',
            'a6000000-0000-4000-a000-000000000001',
            'a7000000-0000-4000-a000-000000000001',
            'customer_name', 'X', '   ', 'a1000000-0000-4000-a000-000000000002');
    raise exception 'ECHEC : motif composé d''espaces accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.skara_document_corrections (
      organization_id, document_id, extraction_id, field_name,
      corrected_value, reason, corrected_by)
    values ('00000000-0000-4000-a000-000000000001',
            'a6000000-0000-4000-a000-000000000001',
            'a7000000-0000-4000-a000-000000000001',
            'customer_name', 'X', '', 'a1000000-0000-4000-a000-000000000002');
    raise exception 'ECHEC : motif vide accepté';
  exception when check_violation then null;
  end;
  raise notice 'TEST 11 OK — motif de correction obligatoire et non vide';
end $$;

-- ===========================================================================
-- TEST 12 — Références interorganisation refusées, même avec la clé serveur
-- ===========================================================================
do $$
begin
  -- Dossier de A pointant vers un magasin… inexistant côté A car appartenant
  -- à B : ici on teste avec une ligne logistique et un dossier croisés.
  begin
    insert into public.delivery_allocations (
      organization_id, logistics_line_id, delivery_job_id, quantity_allocated)
    values ('00000000-0000-4000-a000-000000000001',
            'b2000000-0000-4000-b000-000000000001',   -- ligne de B
            'a3000000-0000-4000-a000-000000000001',   -- dossier de A
            1);
    raise exception 'ECHEC : affectation croisée A/B insérée directement';
  exception when insufficient_privilege then null;
  end;

  -- Anomalie de A rattachée à un dossier de B.
  begin
    insert into public.logistics_anomalies (
      organization_id, delivery_job_id, type, message)
    values ('00000000-0000-4000-a000-000000000001',
            'b3000000-0000-4000-b000-000000000001', 'test', 'croisée');
    raise exception 'ECHEC : anomalie croisée insérée';
  exception when insufficient_privilege then null;
  end;

  -- Document de B rattaché à un dossier de A.
  begin
    insert into public.skara_documents (
      organization_id, storage_path, file_name, file_hash, delivery_job_id)
    values ('b0000000-0000-4000-b000-000000000001',
            'x', 'x.pdf', 'hash-croise', 'a3000000-0000-4000-a000-000000000001');
    raise exception 'ECHEC : document croisé inséré';
  exception when insufficient_privilege then null;
  end;

  -- Ligne de A référençant une variante de B.
  begin
    insert into public.logistics_lines (
      organization_id, origin, origin_reason, designation, quantity, variant_id)
    values ('00000000-0000-4000-a000-000000000001', 'stock_local', 'test',
            'Article', 1, 'b5000000-0000-4000-b000-000000000001');
    raise exception 'ECHEC : ligne référençant une variante d''une autre organisation';
  exception when insufficient_privilege then null;
  end;

  -- Journal d'accès de A attribué à un profil de B.
  begin
    insert into public.sensitive_access_logs (
      organization_id, profile_id, action, object_type)
    values ('00000000-0000-4000-a000-000000000001',
            'b1000000-0000-4000-b000-000000000001',
            'consultation_montants', 'delivery_job');
    raise exception 'ECHEC : journal attribué à un profil d''une autre organisation';
  exception when insufficient_privilege then null;
  end;

  raise notice 'TEST 12 OK — aucune référence interorganisation acceptée (écriture privilégiée)';
end $$;

-- Même refus sous service_role (chemin d'ingestion des phases 2-3).
set role service_role;
do $$
begin
  begin
    insert into public.logistics_line_events (
      organization_id, logistics_line_id, event_type, occurred_on)
    values ('00000000-0000-4000-a000-000000000001',
            'b2000000-0000-4000-b000-000000000001',   -- ligne de B
            'reception_argenteuil', current_date);
    raise exception 'ECHEC : service_role a inséré un événement croisé';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TEST 12b OK — la clé serveur ne peut pas franchir la frontière d''organisation';
end $$;
reset role;

-- Le cas légitime (même organisation) reste évidemment accepté.
do $$
begin
  insert into public.logistics_line_events (
    organization_id, logistics_line_id, event_type, occurred_on)
  values ('00000000-0000-4000-a000-000000000001',
          'a2000000-0000-4000-a000-000000000001',
          'reception_argenteuil', current_date);
  raise notice 'TEST 12c OK — référence intra-organisation acceptée normalement';
end $$;

-- ===========================================================================
-- TEST 13 — Référentiel logistique : effacement volontaire et décimaux
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000002';
do $$
declare v_variant uuid;
begin
  select v.id into v_variant
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where p.organization_id = '00000000-0000-4000-a000-000000000001'
  limit 1;

  -- Renseigner, puis EFFACER volontairement (null explicite).
  perform public.set_variant_logistics(v_variant,
    jsonb_build_object('weight_grams', 45000, 'package_count', 3));
  if (select weight_grams from public.product_variants where id = v_variant) <> 45000 then
    raise exception 'ECHEC : valeur non enregistrée';
  end if;

  perform public.set_variant_logistics(v_variant, '{"weight_grams": null}'::jsonb);
  if (select weight_grams from public.product_variants where id = v_variant) is not null then
    raise exception 'ECHEC : effacement volontaire ignoré (coalesce conserve l''ancienne valeur)';
  end if;
  -- Une clé ABSENTE ne doit pas effacer les autres champs.
  if (select package_count from public.product_variants where id = v_variant) <> 3 then
    raise exception 'ECHEC : un champ absent du payload a été effacé';
  end if;

  -- Décimaux refusés, sans arrondi silencieux.
  begin
    perform public.set_variant_logistics(v_variant, '{"weight_grams": 45.7}'::jsonb);
    raise exception 'ECHEC : poids décimal accepté';
  exception when raise_exception then null;
  end;
  begin
    perform public.set_variant_logistics(v_variant, '{"recommended_handlers": 2.5}'::jsonb);
    raise exception 'ECHEC : nombre de livreurs décimal accepté';
  exception when raise_exception then null;
  end;
  -- Le refus ne laisse aucune trace.
  if (select weight_grams from public.product_variants where id = v_variant) is not null then
    raise exception 'ECHEC : une valeur refusée a tout de même été écrite';
  end if;

  -- Vider une dimension efface le volume dérivé.
  perform public.set_variant_logistics(v_variant, jsonb_build_object(
    'packed_length_mm', 2000, 'packed_width_mm', 1000, 'packed_height_mm', 500));
  if (select volume_cm3 from public.product_variants where id = v_variant) is null then
    raise exception 'ECHEC : volume non calculé';
  end if;
  perform public.set_variant_logistics(v_variant, '{"packed_height_mm": null}'::jsonb);
  if (select volume_cm3 from public.product_variants where id = v_variant) is not null then
    raise exception 'ECHEC : volume conservé alors qu''une dimension a été effacée';
  end if;

  raise notice 'TEST 13 OK — effacement volontaire, décimaux refusés, volume cohérent';
end $$;
reset role;

-- ===========================================================================
-- TEST 14 — La création de commande magasin n'est plus exécutable
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-a000-000000000001'; -- admin
do $$
begin
  perform public.create_store_order('{}'::jsonb);
  raise exception 'ECHEC : création de commande magasin encore possible';
exception
  when insufficient_privilege then
    raise notice 'TEST 14 OK — create_store_order non exécutable (Skara crée les commandes)';
end $$;
reset role;

rollback;

\echo 'TOUS LES TESTS PHASE 1 SONT PASSES (transaction annulée, base intacte).'
