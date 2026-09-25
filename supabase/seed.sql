-- ===========================================================================
-- TRUST AI — seed Supabase (RÉFÉRENTIEL UNIQUEMENT, données fictives)
--
-- Contenu : organisation, magasins, dépôts, fournisseurs et un extrait de
-- catalogue. AUCUNE donnée personnelle, AUCUN client, AUCUNE commande de
-- test, AUCUN compte utilisateur, AUCUN mot de passe, AUCUNE clé API.
-- Les données de démonstration localStorage ne sont JAMAIS recopiées ici.
--
-- Les comptes Auth sont créés manuellement (voir docs/SUPABASE_SETUP.md).
-- Ce seed est idempotent (on conflict do nothing).
-- ===========================================================================

insert into public.organizations (id, name)
values ('00000000-0000-4000-a000-000000000001', 'Trust Industrie')
on conflict (id) do nothing;

-- Dépôts (Argenteuil et Aubagne sont des DÉPÔTS, entités distinctes des magasins)
insert into public.warehouses (id, organization_id, name, city, notes)
values
  ('00000000-0000-4000-a000-000000000101', '00000000-0000-4000-a000-000000000001',
   'Dépôt d''Argenteuil', 'Argenteuil',
   'Dépôt principal Île-de-France. Dessert notamment le magasin d''Herblay.'),
  ('00000000-0000-4000-a000-000000000102', '00000000-0000-4000-a000-000000000001',
   'Dépôt d''Aubagne', 'Aubagne',
   'Dépôt Sud, alimenté par affrètement depuis Argenteuil.')
on conflict (id) do nothing;

-- Magasins. Herblay est un MAGASIN rattaché logistiquement au dépôt
-- d'Argenteuil (default_warehouse_id) sans fusion des entités.
-- « Marseille » n'est qu'un ancien alias documentaire d'Aubagne.
insert into public.stores (id, organization_id, code, name, city, aliases, default_warehouse_id)
values
  ('00000000-0000-4000-a000-000000000201', '00000000-0000-4000-a000-000000000001',
   'LIS', 'Trust Lisses', 'Lisses', '{}',
   '00000000-0000-4000-a000-000000000101'),
  ('00000000-0000-4000-a000-000000000202', '00000000-0000-4000-a000-000000000001',
   'HER', 'Trust Herblay', 'Herblay', '{}',
   '00000000-0000-4000-a000-000000000101'),
  ('00000000-0000-4000-a000-000000000203', '00000000-0000-4000-a000-000000000001',
   'AUB', 'Trust Aubagne', 'Aubagne', '{Marseille}',
   '00000000-0000-4000-a000-000000000102')
on conflict (id) do nothing;

-- Fournisseurs (coordonnées d'exemple, aucun identifiant stocké)
insert into public.suppliers (organization_id, name, country, specialties, order_channel, usual_order_day, lead_time_days, logistics)
values
  ('00000000-0000-4000-a000-000000000001', 'GDM', 'France', '{Tables,"Meubles massifs"}', 'whatsapp', 'lundi', 7, 'retrait_trust'),
  ('00000000-0000-4000-a000-000000000001', 'SM', 'France', '{Salons,Canapés}', 'whatsapp', 'lundi', 10, 'retrait_trust'),
  ('00000000-0000-4000-a000-000000000001', 'Great Home', 'Pays-Bas', '{Décoration,"Petits meubles"}', 'site', 'lundi', 14, 'livraison_fournisseur'),
  ('00000000-0000-4000-a000-000000000001', 'Polez', 'Pologne', '{Chambres,Literie}', 'email', null, 21, 'livraison_fournisseur'),
  ('00000000-0000-4000-a000-000000000001', 'Signal', 'Pologne', '{"Meubles TV",Rangements}', 'site', null, 18, 'livraison_fournisseur'),
  ('00000000-0000-4000-a000-000000000001', 'Pole to Pole', 'Pays-Bas', '{"Décoration exotique"}', 'site', null, 15, 'les_deux'),
  ('00000000-0000-4000-a000-000000000001', 'Eleonora', 'Pays-Bas', '{Chaises,Fauteuils}', 'site', 'lundi', 12, 'les_deux'),
  ('00000000-0000-4000-a000-000000000001', 'By Boo', 'Pays-Bas', '{Canapés,"Tables basses",Luminaires}', 'application', 'lundi', 10, 'les_deux'),
  ('00000000-0000-4000-a000-000000000001', 'Dreams Fly', 'France', '{Matelas,Sommiers}', 'whatsapp', null, 5, 'retrait_trust'),
  ('00000000-0000-4000-a000-000000000001', 'Eurodesign', 'Italie', '{"Salles à manger design"}', 'email', null, 28, 'livraison_fournisseur'),
  ('00000000-0000-4000-a000-000000000001', 'Meubel Co', 'Belgique', '{"Meubles en chêne"}', 'site', null, 20, 'les_deux'),
  ('00000000-0000-4000-a000-000000000001', 'JJA', 'France', '{Décoration,Jardin}', 'site', 'lundi', 8, 'livraison_fournisseur'),
  ('00000000-0000-4000-a000-000000000001', 'Luxury Living', 'France', '{"Canapés haut de gamme"}', 'whatsapp', null, 15, 'retrait_trust'),
  ('00000000-0000-4000-a000-000000000001', 'Globe Home Trade', 'France', '{Import,"Mobilier varié"}', 'whatsapp', null, 9, 'retrait_trust')
on conflict (organization_id, name) do nothing;

-- Extrait de catalogue fictif (prix en centimes)
insert into public.products (id, organization_id, title, short_description, category, source)
values
  ('00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000001',
   'Canapé d''angle Milano', 'Canapé d''angle en velours, assise profonde.', 'canapes', 'manuel'),
  ('00000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000001',
   'Table à manger Rustica', 'Table en chêne massif, pieds croisés.', 'tables', 'manuel'),
  ('00000000-0000-4000-a000-000000000303', '00000000-0000-4000-a000-000000000001',
   'Chaise Vera', 'Chaise en velours, piètement métal noir.', 'chaises', 'manuel'),
  ('00000000-0000-4000-a000-000000000304', '00000000-0000-4000-a000-000000000001',
   'Matelas Cloud', 'Matelas mousse à mémoire de forme.', 'matelas', 'manuel')
on conflict (id) do nothing;

insert into public.product_variants (id, product_id, name, sku, price_cents)
values
  ('00000000-0000-4000-a000-000000000401', '00000000-0000-4000-a000-000000000301',
   'Velours vert, angle gauche', 'BB-MIL-VG-G', 149000),
  ('00000000-0000-4000-a000-000000000402', '00000000-0000-4000-a000-000000000302',
   'Chêne massif 220 cm', 'GDM-RUST-220', 119000),
  ('00000000-0000-4000-a000-000000000403', '00000000-0000-4000-a000-000000000303',
   'Velours taupe', 'ELE-VERA-TP', 12900),
  ('00000000-0000-4000-a000-000000000404', '00000000-0000-4000-a000-000000000304',
   '160 × 200', 'DF-CLD-160', 64900)
on conflict (id) do nothing;

insert into public.product_suppliers (organization_id, product_id, variant_id, product_name, variant_label, supplier_id, supplier_reference, lead_time_days, priority, is_primary)
select
  '00000000-0000-4000-a000-000000000001',
  v.product_id, v.id, p.title, v.name, s.id, v.sku, s.lead_time_days, 1, true
from public.product_variants v
join public.products p on p.id = v.product_id
join public.suppliers s on s.organization_id = '00000000-0000-4000-a000-000000000001'
  and s.name = case v.sku
    when 'BB-MIL-VG-G' then 'By Boo'
    when 'GDM-RUST-220' then 'GDM'
    when 'ELE-VERA-TP' then 'Eleonora'
    when 'DF-CLD-160' then 'Dreams Fly'
  end
where v.id::text like '00000000-0000-4000-a000-0000000004%'
on conflict do nothing;
