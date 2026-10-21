-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 21 (création d'un dossier de livraison)
--
-- Prouve, sur une base réelle :
--   1. un dossier naît, avec une référence lisible et l'étape `a_rapprocher` ;
--   2. l'appelant ne peut PAS choisir l'étape de départ ;
--   3. le client est photographié : nom, téléphone, adresse recopiés ;
--   4. la charge utile prime sur la fiche client ;
--   5. un client d'une autre organisation est refusé ;
--   6. un rôle sans `gerer_livraisons` est refusé ;
--   7. la référence Skara interdit le doublon — le double clic ne livre pas
--      deux fois chez le même client ;
--   8. les lignes affectées le sont réellement, et la disponibilité est
--      calculée ;
--   9. une ligne invalide annule la création entière : pas de dossier à
--      moitié constitué ;
--  10. le dossier créé entre bien dans la chaîne existante.
--
-- STRUCTURE : le rôle `authenticated` ne peut PAS lire `delivery_jobs` —
-- la table est verrouillée, et c'est voulu. Les appels se font donc sous ce
-- rôle, et les vérifications en table se font en dehors, après `reset role`,
-- sur les identifiants mémorisés au passage.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('a3000000-0000-4000-a300-000000000001', 'resplog.dossier@test.local'),
  ('a3000000-0000-4000-a300-000000000002', 'vendeur.dossier@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('a3000000-0000-4000-a300-000000000001', '00000000-0000-4000-a000-000000000001',
   'Resp. logistique', 'responsable_logistique'),
  ('a3000000-0000-4000-a300-000000000002', '00000000-0000-4000-a000-000000000001',
   'Vendeur', 'vendeur');

-- Une seconde organisation, pour prouver le cloisonnement.
insert into public.organizations (id, name)
values ('00000000-0000-4000-a000-000000000999', 'Concurrent SAS')
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, email,
                              address, postal_code, city)
values
  ('c3000000-0000-4000-c300-000000000001', '00000000-0000-4000-a000-000000000001',
   'Mme Berthier', '0612345678', 'berthier@test.local',
   '12 rue des Lilas', '13821', 'La Penne-sur-Huveaune'),
  ('c3000000-0000-4000-c300-000000000999', '00000000-0000-4000-a000-000000000999',
   'Client du concurrent', null, null, null, null, null);

create temporary table t as
select
  (select id from public.warehouses
   where organization_id = '00000000-0000-4000-a000-000000000001'
     and city = 'Argenteuil' limit 1) as argenteuil;
grant all on t to authenticated;

-- Les résultats mémorisés au fil des appels, relus après `reset role`.
create temporary table r (cle text primary key, res jsonb);
grant all on r to authenticated;

-- Origine « stock_local » : hors récapitulatif, donc motif obligatoire et
-- aucun champ de récap — c'est la contrainte du socle.
insert into public.logistics_lines
  (id, organization_id, origin, origin_reason, designation, quantity, stage,
   current_warehouse_id, destination_warehouse_id, customer_label)
select
  g.id, '00000000-0000-4000-a000-000000000001',
  'stock_local', 'Jeu d''essai phase 11',
  'Carrelage 60x60 — lot ' || g.n, 4, 'disponible', t.argenteuil, t.argenteuil,
  'Mme Berthier'
from t, (values
  ('11000000-0000-4000-1100-000000000001'::uuid, 1),
  ('11000000-0000-4000-1100-000000000002'::uuid, 2)
) as g(id, n);

-- ===========================================================================
-- PARTIE A — les appels, sous le rôle authentifié
-- ===========================================================================
set role authenticated;
set local "request.jwt.claim.sub" = 'a3000000-0000-4000-a300-000000000001';

-- 1 et 2. Naissance du dossier ; l'étape demandée par l'appelant est ignorée.
do $$
declare v_res jsonb;
begin
  v_res := public.create_delivery_job(jsonb_build_object(
    'customer_id', 'c3000000-0000-4000-c300-000000000001',
    'stage', 'planifie',               -- tentative : doit être ignorée
    'remise_type', 'livraison_piece',
    'notes', 'Troisième étage sans ascenseur.'
  ));
  if v_res->>'id' is null then
    raise exception 'ÉCHEC 1 : aucun dossier créé';
  end if;
  if v_res->>'reference' !~ '^LIV-\d{6}-\d{4}$' then
    raise exception 'ÉCHEC 1 : référence illisible « % »', v_res->>'reference';
  end if;
  if v_res->>'stage' <> 'a_rapprocher' then
    raise exception 'ÉCHEC 2 : étape annoncée « % »', v_res->>'stage';
  end if;
  insert into r values ('base', v_res);
end $$;

-- 4. La charge utile prime sur la fiche client.
do $$
begin
  insert into r values ('prime', public.create_delivery_job(jsonb_build_object(
    'customer_id', 'c3000000-0000-4000-c300-000000000001',
    'address_line', '8 impasse du Vallon',
    'city', 'Aubagne')));
end $$;

-- 5. Un client d'une autre organisation est refusé.
do $$
declare v_erreur text;
begin
  begin
    perform public.create_delivery_job(jsonb_build_object(
      'customer_id', 'c3000000-0000-4000-c300-000000000999'));
    raise exception 'ÉCHEC 5 : un client d''une autre organisation a été accepté';
  exception when sqlstate '42501' then
    get stacked diagnostics v_erreur = message_text;
    if v_erreur not like '%autre organisation%' then
      raise exception 'ÉCHEC 5 : message inattendu « % »', v_erreur;
    end if;
  end;
  raise notice 'OK 5 : cloisonnement par organisation tenu.';
end $$;

-- 7. La référence Skara interdit le doublon.
do $$
declare
  v_premier jsonb;
  v_erreur text;
begin
  v_premier := public.create_delivery_job(jsonb_build_object(
    'customer_id', 'c3000000-0000-4000-c300-000000000001',
    'skara_order_reference', 'CMD-2026-0042'));
  begin
    perform public.create_delivery_job(jsonb_build_object(   -- le double clic
      'customer_id', 'c3000000-0000-4000-c300-000000000001',
      'skara_order_reference', 'CMD-2026-0042'));
    raise exception 'ÉCHEC 7 : deux dossiers pour la même commande Skara';
  exception when sqlstate '23505' then
    get stacked diagnostics v_erreur = message_text;
    -- Le message doit NOMMER le dossier existant, sinon l'utilisateur ne sait
    -- pas où aller le compléter.
    if v_erreur not like '%' || (v_premier->>'reference') || '%' then
      raise exception 'ÉCHEC 7 : le message ne nomme pas le dossier existant : « % »', v_erreur;
    end if;
  end;
  raise notice 'OK 7 : le double clic ne livre pas deux fois.';
end $$;

-- 8. Les lignes sont réellement affectées, la disponibilité est calculée.
do $$
declare v_res jsonb;
begin
  v_res := public.create_delivery_job(jsonb_build_object(
    'customer_id', 'c3000000-0000-4000-c300-000000000001',
    'origin_warehouse_id', (select argenteuil from t),
    'lignes', jsonb_build_array(
      jsonb_build_object('logistics_line_id', '11000000-0000-4000-1100-000000000001',
                         'quantity', 2),
      jsonb_build_object('logistics_line_id', '11000000-0000-4000-1100-000000000002',
                         'quantity', 1))));
  if (v_res->>'lignes_affectees')::int <> 2 then
    raise exception 'ÉCHEC 8 : % ligne(s) affectée(s) au lieu de 2',
      v_res->>'lignes_affectees';
  end if;
  -- Les deux lignes sont disponibles DANS le dépôt d'origine : le dossier est
  -- donc complet, et c'est ce qui le rendra contactable.
  if v_res->'disponibilite'->>'readiness' <> 'complet' then
    raise exception 'ÉCHEC 8 : disponibilité « % » au lieu de « complet »',
      v_res->'disponibilite'->>'readiness';
  end if;
  insert into r values ('affecte', v_res);
  raise notice 'OK 8 : deux affectations, dossier complet.';
end $$;

-- 9. Une ligne invalide annule la création ENTIÈRE.
do $$
declare v_leve boolean := false;
begin
  begin
    perform public.create_delivery_job(jsonb_build_object(
      'customer_id', 'c3000000-0000-4000-c300-000000000001',
      'skara_order_reference', 'CMD-2026-9999',   -- repère pour la partie B
      'lignes', jsonb_build_array(
        jsonb_build_object('logistics_line_id', '11000000-0000-4000-1100-000000000001',
                           'quantity', 1),
        -- Celle-ci n'existe pas : tout doit être annulé.
        jsonb_build_object('logistics_line_id', '11000000-0000-4000-1100-0000000000ff',
                           'quantity', 1))));
  exception when others then
    v_leve := true;
  end;
  if not v_leve then
    raise exception 'ÉCHEC 9 : une ligne inexistante a été acceptée';
  end if;
  raise notice 'OK 9 : la création a été refusée en bloc.';
end $$;

-- 10. Le dossier créé entre dans la chaîne existante.
do $$
declare
  v_lu jsonb;
  v_liste jsonb;
begin
  v_lu := public.get_delivery_job(((select res from r where cle = 'base')->>'id')::uuid);
  if v_lu is null or v_lu = 'null'::jsonb then
    raise exception 'ÉCHEC 10 : le dossier créé n''est pas relu';
  end if;
  v_liste := public.list_delivery_jobs('{}'::jsonb);
  if (v_liste->'totals'->>'dossiers')::int < 1 then
    raise exception 'ÉCHEC 10 : la liste de travail ignore les dossiers créés : %',
      v_liste->'totals';
  end if;
  raise notice 'OK 10 : le dossier entre dans la chaîne.';
end $$;

reset role;

-- 6. Un rôle sans `gerer_livraisons` est refusé.
set role authenticated;
set local "request.jwt.claim.sub" = 'a3000000-0000-4000-a300-000000000002';
do $$
begin
  begin
    perform public.create_delivery_job(jsonb_build_object(
      'customer_name', 'Client tenté par un vendeur'));
    raise exception 'ÉCHEC 6 : un vendeur a créé un dossier de livraison';
  exception when sqlstate '42501' then
    null;
  end;
  raise notice 'OK 6 : la permission gerer_livraisons est exigée.';
end $$;
reset role;

-- ===========================================================================
-- PARTIE B — les vérifications en table, hors du rôle authentifié
-- ===========================================================================
do $$
declare
  v_job public.delivery_jobs%rowtype;
  v_n integer;
begin
  -- 2 et 3. L'étape imposée et la photographie du client.
  select * into v_job from public.delivery_jobs
  where id = ((select res from r where cle = 'base')->>'id')::uuid;

  if v_job.stage <> 'a_rapprocher' then
    raise exception 'ÉCHEC 2 : le dossier est né à l''étape « % »', v_job.stage;
  end if;
  if v_job.customer_name <> 'Mme Berthier'
     or v_job.customer_phone <> '0612345678'
     or v_job.address_line <> '12 rue des Lilas'
     or v_job.postal_code <> '13821'
     or v_job.city <> 'La Penne-sur-Huveaune' then
    raise exception 'ÉCHEC 3 : le client n''est pas recopié (%, %, %)',
      v_job.customer_name, v_job.customer_phone, v_job.address_line;
  end if;
  if v_job.customer_id is null then
    raise exception 'ÉCHEC 3 : le lien vers la fiche client est perdu';
  end if;
  if v_job.created_by is null then
    raise exception 'ÉCHEC 3 : le créateur n''est pas tracé';
  end if;
  if v_job.remise_type <> 'livraison_piece' then
    raise exception 'ÉCHEC 3 : mode de remise perdu (%)', v_job.remise_type;
  end if;
  raise notice 'OK 1-3 : dossier % né à rapprocher, client photographié.',
    v_job.reference;

  -- 4. La charge utile prime sur la fiche.
  select * into v_job from public.delivery_jobs
  where id = ((select res from r where cle = 'prime')->>'id')::uuid;
  if v_job.address_line <> '8 impasse du Vallon' or v_job.city <> 'Aubagne' then
    raise exception 'ÉCHEC 4 : la fiche client a écrasé l''adresse fournie (%, %)',
      v_job.address_line, v_job.city;
  end if;
  -- Ce qui n'était pas fourni vient bien de la fiche.
  if v_job.customer_phone <> '0612345678' then
    raise exception 'ÉCHEC 4 : le téléphone de la fiche n''a pas été repris';
  end if;
  raise notice 'OK 4 : l''adresse constatée prime sur la fiche.';

  -- 8. Les affectations sont bien en base.
  select count(*) into v_n from public.delivery_allocations
  where delivery_job_id = ((select res from r where cle = 'affecte')->>'id')::uuid;
  if v_n <> 2 then
    raise exception 'ÉCHEC 8 : % affectation(s) en base au lieu de 2', v_n;
  end if;

  -- 9. Aucun dossier à moitié constitué n'a survécu.
  select count(*) into v_n from public.delivery_jobs
  where skara_order_reference = 'CMD-2026-9999';
  if v_n <> 0 then
    raise exception 'ÉCHEC 9 : % dossier(s) à moitié constitué(s) laissé(s)', v_n;
  end if;
  -- Et la ligne de la tentative n'a pas été consommée.
  select count(*) into v_n from public.delivery_allocations
  where logistics_line_id = '11000000-0000-4000-1100-000000000001';
  if v_n <> 1 then
    raise exception 'ÉCHEC 9 : % affectation(s) sur la ligne au lieu de 1', v_n;
  end if;
  raise notice 'OK 9 : aucun dossier ni affectation orpheline.';

  -- Les références se suivent, sans trou ni doublon.
  select count(distinct reference) into v_n from public.delivery_jobs
  where organization_id = '00000000-0000-4000-a000-000000000001';
  if v_n < 4 then
    raise exception 'ÉCHEC : % référence(s) distincte(s), 4 attendues au moins', v_n;
  end if;
  raise notice 'OK : % références distinctes, aucune collision.', v_n;
end $$;

rollback;
