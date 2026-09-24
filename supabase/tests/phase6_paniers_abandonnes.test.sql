-- ===========================================================================
-- TRUST AI — Tests de la MIGRATION 14 (paniers abandonnés)
--
-- Prouve, sur une base réelle :
--   1. le statut est calculé par la BASE : sans adresse « sans_contact »,
--      sans consentement « sans_consentement », avec consentement
--      « a_relancer » ;
--   2. une adresse désinscrite rend le panier « exclu », motif compris ;
--   3. la lecture est idempotente : deux fois la même lecture ne crée pas de
--      doublon et ne change pas le statut ;
--   4. une exclusion humaine est PRÉSERVÉE par la lecture suivante et vide
--      la file d'envoi du panier ;
--   5. la réintégration RECALCULE : un panier sans consentement ne redevient
--      pas relançable ;
--   6. une commande portant le jeton de checkout ferme le panier
--      automatiquement, trace l'événement et annule les messages planifiés ;
--   7. un panier récupéré ne se décide plus ;
--   8. permissions : « logistique » ne lit pas et ne décide pas, une autre
--      organisation ne voit rien, une décision sans motif est refusée ;
--   9. aucune lecture directe des quatre tables.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE donnée.
-- ===========================================================================
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, name)
values ('b0000000-0000-4000-b000-000000000002', 'Organisation C (test)')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('f1000000-0000-4000-f000-000000000001', 'admin.f@test.local'),
  ('f1000000-0000-4000-f000-000000000002', 'respmag.f@test.local'),
  ('f1000000-0000-4000-f000-000000000003', 'logistique.f@test.local'),
  ('f1000000-0000-4000-f000-000000000004', 'admin.f.c@test.local');

insert into public.profiles (id, organization_id, display_name, role) values
  ('f1000000-0000-4000-f000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Admin F', 'administrateur'),
  ('f1000000-0000-4000-f000-000000000002', '00000000-0000-4000-a000-000000000001',
   'Resp. magasin F', 'responsable_magasin'),
  ('f1000000-0000-4000-f000-000000000003', '00000000-0000-4000-a000-000000000001',
   'Logistique F', 'logistique'),
  ('f1000000-0000-4000-f000-000000000004', 'b0000000-0000-4000-b000-000000000002',
   'Admin F (C)', 'administrateur');

-- Un client existant, pour vérifier le rattachement par adresse.
insert into public.customers (id, organization_id, name, email)
values ('f2000000-0000-4000-f000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        'Client Panier', 'Client.Panier@Example.COM');

-- Une adresse désinscrite.
insert into public.message_suppressions (organization_id, channel, address, reason)
values ('00000000-0000-4000-a000-000000000001', 'email',
        'desinscrit@example.com', 'Lien de désinscription.');

create temporary table ctx as
select null::uuid as sans_contact,
       null::uuid as sans_consentement,
       null::uuid as relancable,
       null::uuid as desinscrit;
grant all on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- 1 et 2. Première lecture : quatre paniers, quatre statuts calculés
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000001';

do $$
declare v_report jsonb;
begin
  v_report := public.upsert_abandoned_checkouts(jsonb_build_array(
    jsonb_build_object(
      'shopify_checkout_id', 'C-1', 'abandoned_at', '2026-09-20T10:00:00Z',
      'total_cents', 129900, 'currency', 'EUR', 'item_count', 2,
      'recovery_url', 'https://boutique.example/recover/1'),
    jsonb_build_object(
      'shopify_checkout_id', 'C-2', 'abandoned_at', '2026-09-20T11:00:00Z',
      'total_cents', 45000, 'item_count', 1,
      'contact_email', 'Sans.Consentement@Example.com',
      'marketing_consent', false,
      'recovery_url', 'https://boutique.example/recover/2'),
    jsonb_build_object(
      'shopify_checkout_id', 'C-3', 'abandoned_at', '2026-09-20T12:00:00Z',
      'checkout_token', 'jeton-c3', 'total_cents', 89900, 'item_count', 3,
      'contact_email', 'Client.Panier@Example.COM', 'contact_name', 'Client Panier',
      'marketing_consent', true,
      'recovery_url', 'https://boutique.example/recover/3'),
    jsonb_build_object(
      'shopify_checkout_id', 'C-4', 'abandoned_at', '2026-09-20T13:00:00Z',
      'total_cents', 1000, 'item_count', 1,
      'contact_email', 'desinscrit@example.com', 'marketing_consent', true)));

  if (v_report->>'created')::int <> 4 then
    raise exception 'ÉCHEC 1 : % panier(s) créé(s) au lieu de 4', v_report->>'created';
  end if;
  if (v_report->>'eligible')::int <> 1 then
    raise exception 'ÉCHEC 1 : % panier(s) éligible(s) au lieu de 1', v_report->>'eligible';
  end if;
end $$;

reset role;
update ctx set
  sans_contact = (select id from public.shopify_abandoned_checkouts where shopify_checkout_id='C-1'),
  sans_consentement = (select id from public.shopify_abandoned_checkouts where shopify_checkout_id='C-2'),
  relancable = (select id from public.shopify_abandoned_checkouts where shopify_checkout_id='C-3'),
  desinscrit = (select id from public.shopify_abandoned_checkouts where shopify_checkout_id='C-4');

do $$
declare v record;
begin
  select
    (select status from public.shopify_abandoned_checkouts where shopify_checkout_id='C-1') as s1,
    (select status from public.shopify_abandoned_checkouts where shopify_checkout_id='C-2') as s2,
    (select status from public.shopify_abandoned_checkouts where shopify_checkout_id='C-3') as s3,
    (select status from public.shopify_abandoned_checkouts where shopify_checkout_id='C-4') as s4,
    (select customer_id from public.shopify_abandoned_checkouts where shopify_checkout_id='C-3') as cust,
    (select contact_email from public.shopify_abandoned_checkouts where shopify_checkout_id='C-3') as mail
  into v;
  if v.s1 <> 'sans_contact' then raise exception 'ÉCHEC 1 : C-1 = %', v.s1; end if;
  if v.s2 <> 'sans_consentement' then raise exception 'ÉCHEC 1 : C-2 = %', v.s2; end if;
  if v.s3 <> 'a_relancer' then raise exception 'ÉCHEC 1 : C-3 = %', v.s3; end if;
  if v.s4 <> 'exclu' then raise exception 'ÉCHEC 2 : C-4 = %', v.s4; end if;
  if v.cust <> 'f2000000-0000-4000-f000-000000000001' then
    raise exception 'ÉCHEC 1 : client non rattaché (%)', v.cust;
  end if;
  -- L'adresse est normalisée en minuscules à l'écriture.
  if v.mail <> 'client.panier@example.com' then
    raise exception 'ÉCHEC 1 : adresse non normalisée (%)', v.mail;
  end if;
  raise notice 'OK 1 et 2 : statuts calculés par la base, désinscription respectée.';
end $$;

-- Un message planifié sur le panier relançable, pour vérifier les annulations.
insert into public.customer_messages (
  organization_id, channel, template, recipient, related_type, related_id,
  scheduled_at)
select '00000000-0000-4000-a000-000000000001', 'email', 'panier_abandonne_1',
       'client.panier@example.com', 'panier_abandonne', relancable,
       now() + interval '1 hour'
from ctx;

-- ---------------------------------------------------------------------------
-- 3. Deuxième lecture identique : aucun doublon, aucun changement de statut
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000001';

do $$
declare v_report jsonb; v_count integer; v_events integer;
begin
  v_report := public.upsert_abandoned_checkouts(jsonb_build_array(
    jsonb_build_object(
      'shopify_checkout_id', 'C-3', 'abandoned_at', '2026-09-20T12:00:00Z',
      'checkout_token', 'jeton-c3', 'total_cents', 89900, 'item_count', 3,
      'contact_email', 'client.panier@example.com', 'marketing_consent', true,
      'recovery_url', 'https://boutique.example/recover/3')));

  if (v_report->>'created')::int <> 0 or (v_report->>'updated')::int <> 1 then
    raise exception 'ÉCHEC 3 : rapport inattendu %', v_report::text;
  end if;
end $$;
reset role;

do $$
declare v_count integer; v_events integer;
begin
  select count(*) into v_count from public.shopify_abandoned_checkouts
  where shopify_checkout_id = 'C-3';
  if v_count <> 1 then raise exception 'ÉCHEC 3 : % lignes pour C-3', v_count; end if;
  -- Statut inchangé : aucun événement « statut » ajouté.
  select count(*) into v_events from public.abandoned_checkout_events e
  join public.shopify_abandoned_checkouts a on a.id = e.checkout_id
  where a.shopify_checkout_id = 'C-3';
  if v_events <> 1 then
    raise exception 'ÉCHEC 3 : % événement(s) au lieu de 1 (découverte)', v_events;
  end if;
  raise notice 'OK 3 : lecture idempotente.';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Exclusion humaine : préservée par la lecture, file d'envoi vidée
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000002';

do $$
declare v_ctx record; v_json jsonb;
begin
  select * into v_ctx from ctx;
  v_json := public.set_abandoned_checkout_exclusion(
    v_ctx.relancable, true, 'Client déjà relancé par téléphone.');
  if v_json->>'status' <> 'exclu' then
    raise exception 'ÉCHEC 4 : statut % après exclusion', v_json->>'status';
  end if;
end $$;
reset role;

do $$
declare v_ctx record; v_msg text; v_reason text;
begin
  select * into v_ctx from ctx;
  select status into v_msg from public.customer_messages
  where related_id = v_ctx.relancable;
  if v_msg <> 'annule' then
    raise exception 'ÉCHEC 4 : message encore « % » après exclusion', v_msg;
  end if;
  select exclusion_reason into v_reason from public.shopify_abandoned_checkouts
  where id = v_ctx.relancable;
  if v_reason is null then raise exception 'ÉCHEC 4 : exclusion sans motif'; end if;
end $$;

set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000001';
do $$
declare v_report jsonb;
begin
  v_report := public.upsert_abandoned_checkouts(jsonb_build_array(
    jsonb_build_object(
      'shopify_checkout_id', 'C-3', 'abandoned_at', '2026-09-20T12:00:00Z',
      'checkout_token', 'jeton-c3', 'total_cents', 99900, 'item_count', 4,
      'contact_email', 'client.panier@example.com', 'marketing_consent', true)));
  if (v_report->>'preserved')::int <> 1 then
    raise exception 'ÉCHEC 4 : décision non préservée (%)', v_report::text;
  end if;
end $$;
reset role;

do $$
declare v_ctx record; v_row record;
begin
  select * into v_ctx from ctx;
  select status, total_cents into v_row from public.shopify_abandoned_checkouts
  where id = v_ctx.relancable;
  if v_row.status <> 'exclu' then
    raise exception 'ÉCHEC 4 : la lecture a écrasé l''exclusion (%)', v_row.status;
  end if;
  -- Les données volatiles, elles, sont bien rafraîchies.
  if v_row.total_cents <> 99900 then
    raise exception 'ÉCHEC 4 : montant non rafraîchi (%)', v_row.total_cents;
  end if;
  raise notice 'OK 4 : exclusion préservée, file vidée, montant rafraîchi.';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Réintégration : le statut est recalculé, pas restauré
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000002';

do $$
declare v_ctx record; v_json jsonb;
begin
  select * into v_ctx from ctx;
  -- Le panier relançable réintégré redevient relançable.
  v_json := public.set_abandoned_checkout_exclusion(
    v_ctx.relancable, false, 'Relance téléphonique sans suite.');
  if v_json->>'status' <> 'a_relancer' then
    raise exception 'ÉCHEC 5 : statut % après réintégration', v_json->>'status';
  end if;

  -- Exclure puis réintégrer un panier SANS consentement ne le rend pas
  -- relançable : la règle de consentement est recalculée.
  perform public.set_abandoned_checkout_exclusion(
    v_ctx.sans_consentement, true, 'Test exclusion.');
  v_json := public.set_abandoned_checkout_exclusion(
    v_ctx.sans_consentement, false, 'Test réintégration.');
  if v_json->>'status' <> 'sans_consentement' then
    raise exception 'ÉCHEC 5 : consentement contourné (%)', v_json->>'status';
  end if;

  -- Un panier dont l'adresse est désinscrite ne peut pas être réintégré.
  begin
    perform public.set_abandoned_checkout_exclusion(
      v_ctx.desinscrit, false, 'Tentative de réintégration.');
    raise exception 'ÉCHEC 5 : réintégration d''une adresse désinscrite acceptée';
  exception when others then
    if position('désinscrite' in sqlerrm) = 0 then raise; end if;
  end;
  raise notice 'OK 5 : réintégration recalculée, consentement et désinscription tenus.';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Attribution automatique par la commande
-- ---------------------------------------------------------------------------
-- Un message est de nouveau planifié : la commande doit l'annuler.
insert into public.customer_messages (
  organization_id, channel, template, recipient, related_type, related_id,
  scheduled_at)
select '00000000-0000-4000-a000-000000000001', 'email', 'panier_abandonne_2',
       'client.panier@example.com', 'panier_abandonne', relancable,
       now() + interval '1 hour'
from ctx;

insert into public.orders (
  id, organization_id, reference, origin, store_id, customer_id, ordered_at,
  fulfillment_mode, shopify_checkout_token)
values ('f3000000-0000-4000-f000-000000000001',
        '00000000-0000-4000-a000-000000000001', 'WEB-TEST-1', 'SHOPIFY',
        '00000000-0000-4000-a000-000000000201',
        'f2000000-0000-4000-f000-000000000001', now(), 'livraison', 'jeton-c3');

do $$
declare v_ctx record; v_row record; v_event integer; v_msg text;
begin
  select * into v_ctx from ctx;
  select status, recovered_order_id, recovered_at
  into v_row from public.shopify_abandoned_checkouts where id = v_ctx.relancable;
  if v_row.status <> 'recupere' then
    raise exception 'ÉCHEC 6 : statut % après la commande', v_row.status;
  end if;
  if v_row.recovered_order_id <> 'f3000000-0000-4000-f000-000000000001' then
    raise exception 'ÉCHEC 6 : commande non rattachée';
  end if;
  if v_row.recovered_at is null then
    raise exception 'ÉCHEC 6 : date de récupération absente';
  end if;
  select count(*) into v_event from public.abandoned_checkout_events
  where checkout_id = v_ctx.relancable and action = 'recupere' and source = 'commande';
  if v_event <> 1 then raise exception 'ÉCHEC 6 : % trace(s) de récupération', v_event; end if;
  select status into v_msg from public.customer_messages
  where related_id = v_ctx.relancable and template = 'panier_abandonne_2';
  if v_msg <> 'annule' then
    raise exception 'ÉCHEC 6 : message encore « % » après la commande', v_msg;
  end if;
  raise notice 'OK 6 : attribution automatique, trace et file annulée.';
end $$;

-- ---------------------------------------------------------------------------
-- 7 et 8. Panier récupéré figé, permissions, motif obligatoire
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000002';

do $$
declare v_ctx record;
begin
  select * into v_ctx from ctx;
  begin
    perform public.set_abandoned_checkout_exclusion(
      v_ctx.relancable, true, 'Trop tard.');
    raise exception 'ÉCHEC 7 : exclusion d''un panier récupéré acceptée';
  exception when others then
    if position('récupéré' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.set_abandoned_checkout_exclusion(v_ctx.sans_contact, true, 'ok');
    raise exception 'ÉCHEC 8 : décision sans motif suffisant acceptée';
  exception when others then
    if position('motivée' in sqlerrm) = 0 then raise; end if;
  end;
  raise notice 'OK 7 et 8a : panier récupéré figé, motif obligatoire.';
end $$;
reset role;

set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000003';
do $$
declare v_ctx record;
begin
  select * into v_ctx from ctx;
  begin
    perform public.list_abandoned_checkouts();
    raise exception 'ÉCHEC 8 : le rôle logistique a lu les paniers';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.set_abandoned_checkout_exclusion(
      v_ctx.sans_contact, true, 'Tentative sans permission.');
    raise exception 'ÉCHEC 8 : le rôle logistique a décidé';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  begin
    perform public.upsert_abandoned_checkouts('[]'::jsonb);
    raise exception 'ÉCHEC 8 : le rôle logistique a synchronisé';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000004';
do $$
declare v_ctx record; v_json jsonb;
begin
  select * into v_ctx from ctx;
  -- Organisation C : aucun panier visible.
  v_json := public.list_abandoned_checkouts();
  if jsonb_array_length(v_json->'rows') <> 0 then
    raise exception 'ÉCHEC 8 : une autre organisation voit % panier(s)',
      jsonb_array_length(v_json->'rows');
  end if;
  begin
    perform public.get_abandoned_checkout(v_ctx.sans_contact);
    raise exception 'ÉCHEC 8 : lecture interorganisation acceptée';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK 8 : permissions et isolation par organisation tenues.';
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 9. Aucune lecture directe des quatre tables
-- ---------------------------------------------------------------------------
set role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-4000-f000-000000000001';
do $$
declare t text; v integer;
begin
  foreach t in array array['shopify_abandoned_checkouts',
                           'abandoned_checkout_events',
                           'customer_messages',
                           'message_suppressions']
  loop
    begin
      execute format('select count(*) from public.%I', t) into v;
      raise exception 'ÉCHEC 9 : lecture directe de % autorisée', t;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  raise notice 'OK 9 : les quatre tables ne sont pas lisibles directement.';
end $$;
reset role;

rollback;
