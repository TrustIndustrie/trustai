-- ============================================================================
-- TRUST AI — Migration 21 : CRÉATION D'UN DOSSIER DE LIVRAISON (entrée de chaîne)
-- ----------------------------------------------------------------------------
-- LE CONSTAT QUI JUSTIFIE CETTE MIGRATION.
--
-- Le socle logistique nomme toute la chaîne du dossier de livraison, les
-- créneaux existent (migration 18), les tournées aussi (migration 19), le
-- livreur a ses droits (migration 20). Et pourtant la table `delivery_jobs`
-- est VIDE en production : zéro dossier, donc zéro créneau, zéro tournée,
-- zéro passage.
--
-- La cause est simple : `insert into public.delivery_jobs` n'existait que
-- dans les jeux d'essai. Aucune fonction ne créait de dossier. Trois lots de
-- travail étaient suspendus à une porte qui n'avait jamais été posée.
--
-- Cette migration pose cette porte, et elle seule.
--
-- CE QU'ELLE FAIT
--
--   `public.create_delivery_job(jsonb)` — crée un dossier pour un client, en
--   y affectant éventuellement des lignes logistiques, et rend son
--   identifiant, sa référence et sa disponibilité calculée.
--
-- CE QU'ELLE NE FAIT PAS, ET C'EST DÉLIBÉRÉ
--
--   * ELLE NE DÉCLENCHE RIEN TOUTE SEULE. Aucun déclencheur automatique,
--     aucune règle « toute ligne disponible devient un dossier ». La règle
--     métier — qui crée un dossier, quand, sur quel signal — n'est pas encore
--     connue : elle dépend de la façon dont la commande parvient au
--     responsable logistique, question ouverte au 21 octobre 2026. Poser une
--     règle maintenant reviendrait à inventer le métier.
--
--   * ELLE NE CONTACTE PERSONNE. Pas de SMS, pas de courriel, aucune date
--     proposée. Le dossier naît à l'étape `a_rapprocher`, et c'est
--     `authorize_delivery_contact` (migration 18) qui ouvre la suite, sur
--     geste humain.
--
--   * ELLE N'ÉCRIT RIEN DANS LE GOOGLE SHEET, ni dans Skara.
--
--   * ELLE NE FAIT PAS AVANCER L'ÉTAPE du dossier. L'appelant ne peut pas
--     choisir l'étape de départ : elle vaut toujours `a_rapprocher`.
--
-- TROIS CHOIX QUI MÉRITENT EXPLICATION
--
--   1. LE CLIENT EST PHOTOGRAPHIÉ, PAS SEULEMENT RÉFÉRENCÉ. Le dossier porte
--      `customer_id` ET une copie du nom, du téléphone et de l'adresse. Une
--      fiche client corrigée six mois plus tard ne doit pas réécrire
--      l'adresse à laquelle on a réellement livré. C'est un fait, pas un
--      état technique.
--
--   2. LA RÉFÉRENCE SKARA SERT DE CLÉ D'IDEMPOTENCE. Appeler deux fois avec
--      la même `skara_order_reference` lève une erreur explicite plutôt que
--      de créer un doublon. Sans cela, un double clic produisait deux
--      dossiers pour la même commande, et deux livraisons chez le client.
--
--   3. L'AFFECTATION RÉUTILISE `allocate_to_delivery_job`. Cette fonction
--      verrouille déjà la ligne et interdit la suraffectation. Réécrire sa
--      logique ici aurait produit deux vérités divergentes.
--
-- MIGRATION REJOUABLE : elle ne contient que des `create or replace function`,
-- aucune table, aucune colonne. La coller deux fois dans le SQL Editor est
-- sans effet de bord, et la CI le vérifie en l'appliquant deux fois puis en
-- comparant l'empreinte du schéma.
-- ============================================================================

begin;

-- ===========================================================================
-- 1. Référence lisible d'un dossier
-- ===========================================================================
--
-- Format `LIV-AAAAMM-NNNN`, numérotée par organisation et par mois. Un
-- numéro lisible compte : c'est lui qu'on prononce au téléphone avec un
-- client ou un livreur.
--
-- Le verrou consultatif sérialise deux créations simultanées. Sans lui, deux
-- appels concurrents lisaient le même maximum et produisaient la même
-- référence : la contrainte d'unicité faisait alors échouer le second avec
-- un message incompréhensible pour l'utilisateur.

create or replace function app.next_delivery_job_reference(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefixe text := 'LIV-' || to_char(now(), 'YYYYMM');
  v_rang integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_org::text || ':delivery_job_reference'));

  select coalesce(max(substring(reference from '(\d+)$')::integer), 0) + 1
    into v_rang
  from public.delivery_jobs
  where organization_id = p_org
    and reference like v_prefixe || '-%';

  return v_prefixe || '-' || lpad(v_rang::text, 4, '0');
end;
$$;

revoke all on function app.next_delivery_job_reference(uuid) from public;
revoke all on function app.next_delivery_job_reference(uuid) from anon;

-- ===========================================================================
-- 2. Création du dossier
-- ===========================================================================
--
-- Charge utile attendue :
--
--   {
--     "customer_id": "uuid",            -- facultatif, mais recommandé
--     "customer_name": "…",             -- obligatoire si pas de customer_id
--     "customer_phone": "…",            -- facultatifs : complètent ou
--     "customer_email": "…",            --   remplacent la fiche client
--     "address_line": "…",
--     "postal_code": "…",
--     "city": "…",
--     "access_notes": "…",
--     "store_id": "uuid",               -- magasin d'origine de la commande
--     "origin_warehouse_id": "uuid",    -- dépôt d'où part la livraison
--     "remise_type": "livraison_piece",
--     "skara_order_reference": "…",     -- clé d'idempotence
--     "skara_document_reference": "…",
--     "expected_ready_at": "2026-11-05",
--     "priority": 0,
--     "notes": "…",
--     "lignes": [ { "logistics_line_id": "uuid", "quantity": 2 } ]
--   }

create or replace function public.create_delivery_job(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_org uuid;
  v_customer public.customers%rowtype;
  v_customer_id uuid;
  v_nom text;
  v_reference text;
  v_store uuid;
  v_warehouse uuid;
  v_remise text;
  v_skara_order text;
  v_existant text;
  v_job_id uuid;
  v_ligne jsonb;
  v_affectees integer := 0;
begin
  v_profile := app.require_permission('gerer_livraisons');
  v_org := app.current_org_id();

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'La charge utile du dossier doit être un objet.'
      using errcode = '22023';
  end if;

  -- --- Le client -----------------------------------------------------------
  v_customer_id := nullif(p_payload->>'customer_id', '')::uuid;
  if v_customer_id is not null then
    select * into v_customer from public.customers where id = v_customer_id;
    if not found then
      raise exception 'Client introuvable.';
    end if;
    -- ISOLATION : le client doit appartenir à l'organisation de l'appelant.
    if v_customer.organization_id <> v_org then
      raise exception 'Accès refusé : ce client appartient à une autre organisation.'
        using errcode = '42501';
    end if;
  end if;

  -- La photographie du client : la charge utile prime sur la fiche, parce que
  -- c'est l'adresse constatée à la prise de commande qui fait foi.
  v_nom := coalesce(
    nullif(btrim(coalesce(p_payload->>'customer_name', '')), ''),
    v_customer.name);
  if v_nom is null then
    raise exception 'Un dossier de livraison exige un client : donnez « customer_id » ou « customer_name ».'
      using errcode = '22023';
  end if;

  -- --- Les rattachements ----------------------------------------------------
  v_store := nullif(p_payload->>'store_id', '')::uuid;
  if v_store is not null
     and not exists (select 1 from public.stores s
                     where s.id = v_store and s.organization_id = v_org) then
    raise exception 'Magasin inconnu dans cette organisation.' using errcode = '42501';
  end if;

  v_warehouse := nullif(p_payload->>'origin_warehouse_id', '')::uuid;
  if v_warehouse is not null
     and not exists (select 1 from public.warehouses w
                     where w.id = v_warehouse and w.organization_id = v_org) then
    raise exception 'Dépôt inconnu dans cette organisation.' using errcode = '42501';
  end if;

  v_remise := nullif(p_payload->>'remise_type', '');
  if v_remise is not null and v_remise not in (
    'retrait_magasin','retrait_depot','livraison_pied_immeuble',
    'livraison_piece','livraison_installation'
  ) then
    raise exception 'Mode de remise inconnu : %.', v_remise using errcode = '22023';
  end if;

  -- --- L'idempotence --------------------------------------------------------
  -- Un double clic ne doit pas produire deux livraisons chez le même client.
  v_skara_order := nullif(btrim(coalesce(p_payload->>'skara_order_reference', '')), '');
  if v_skara_order is not null then
    select reference into v_existant
    from public.delivery_jobs
    where organization_id = v_org
      and skara_order_reference = v_skara_order
      and stage <> 'annule'
    limit 1;
    if v_existant is not null then
      raise exception
        'Un dossier existe déjà pour la commande Skara % : %. Complétez-le plutôt que d''en créer un second.',
        v_skara_order, v_existant using errcode = '23505';
    end if;
  end if;

  -- --- Le dossier -----------------------------------------------------------
  v_reference := coalesce(
    nullif(btrim(coalesce(p_payload->>'reference', '')), ''),
    app.next_delivery_job_reference(v_org));

  insert into public.delivery_jobs (
    organization_id, reference, skara_order_reference, skara_document_reference,
    customer_id, customer_name, customer_phone, customer_email,
    address_line, postal_code, city, access_notes,
    store_id, origin_warehouse_id, remise_type,
    -- L'étape de départ n'est JAMAIS choisie par l'appelant : un dossier naît
    -- à rapprocher, et seul un geste humain le fait avancer.
    stage, expected_ready_at, priority, notes, created_by
  ) values (
    v_org, v_reference, v_skara_order,
    nullif(btrim(coalesce(p_payload->>'skara_document_reference', '')), ''),
    v_customer_id, v_nom,
    coalesce(nullif(btrim(coalesce(p_payload->>'customer_phone', '')), ''), v_customer.phone),
    coalesce(nullif(btrim(coalesce(p_payload->>'customer_email', '')), ''), v_customer.email),
    coalesce(nullif(btrim(coalesce(p_payload->>'address_line', '')), ''), v_customer.address),
    coalesce(nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''), v_customer.postal_code),
    coalesce(nullif(btrim(coalesce(p_payload->>'city', '')), ''), v_customer.city),
    nullif(btrim(coalesce(p_payload->>'access_notes', '')), ''),
    v_store, v_warehouse, v_remise,
    'a_rapprocher',
    nullif(p_payload->>'expected_ready_at', '')::date,
    coalesce((p_payload->>'priority')::integer, 0),
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
    v_profile
  )
  returning id into v_job_id;

  -- --- Les lignes affectées ---------------------------------------------------
  -- On réutilise `allocate_to_delivery_job` : elle verrouille la ligne et
  -- interdit la suraffectation. Toute erreur de sa part annule la création du
  -- dossier entier — on ne laisse pas un dossier à moitié constitué.
  if jsonb_typeof(p_payload->'lignes') = 'array' then
    for v_ligne in select * from jsonb_array_elements(p_payload->'lignes')
    loop
      perform public.allocate_to_delivery_job(
        (v_ligne->>'logistics_line_id')::uuid,
        v_job_id,
        coalesce((v_ligne->>'quantity')::integer, 1));
      v_affectees := v_affectees + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'id', v_job_id,
    'reference', v_reference,
    'stage', 'a_rapprocher',
    'lignes_affectees', v_affectees,
    -- La disponibilité est CALCULÉE, jamais stockée : elle serait fausse au
    -- premier rafraîchissement du récapitulatif.
    'disponibilite', app.delivery_readiness(v_job_id));
end;
$$;

-- ===========================================================================
-- 3. Droits d'exécution
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_delivery_job(jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
