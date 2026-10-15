# Phase 1 — Socle logistique : procédure d'application

Ce document décrit **exactement** ce qu'il faut faire pour appliquer la
migration 9 (socle logistique), uniquement depuis les interfaces web de
Supabase et Vercel. Aucun terminal, aucun dépôt local, aucun secret.

> **Rien n'a été appliqué automatiquement.** La migration est écrite dans le
> dépôt ; c'est vous qui l'exécutez, à votre rythme, après sauvegarde.

## Ce que la phase 1 change

* **13 nouvelles tables** (récapitulatif, lignes logistiques et leurs
  événements, dossiers de livraison, affectations, documents Skara et leurs
  corrections, rapprochements, anomalies, journaux) ;
* **7 nouvelles permissions** et **2 nouveaux rôles** (responsable
  logistique, livreur — ce dernier sans aucun droit en phase 1) ;
* **4 fonctions serveur** ; aucune table logistique n'est lisible
  directement depuis le navigateur ;
* champs **logistiques** sur les variantes (poids, dimensions emballées,
  colis, fragilité, installation, livreurs conseillés) ;
* navigation recentrée ; modules commerciaux déplacés dans
  **Paramètres › Archives** (rien n'est supprimé).

Aucune donnée existante n'est modifiée : la migration n'exécute ni `update`
ni `delete` sur les tables actuelles.

---

## Étape 0 — Vérifier l'état réel de la base

SQL Editor → coller → **Run**. Cette requête ne modifie rien.

```sql
select
  exists (select 1 from information_schema.tables
          where table_schema='public' and table_name='orders')                as m1_schema_initial,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='app' and p.proname='has_permission')               as m2_rls,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='create_store_order')        as m3_fonctions_metier,
  exists (select 1 from information_schema.tables
          where table_schema='public' and table_name='shopify_webhook_events') as m4_shopify,
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='shopify_webhook_events'
            and column_name='webhook_id')                                     as m5_idempotence,
  exists (select 1 from pg_indexes
          where schemaname='public' and indexname='product_variants_manual_sku_key') as m6_sku_doublons,
  exists (select 1 from pg_constraint
          where conname='product_variants_shopify_id_key' and contype='u')    as m7_upserts_groupes,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='set_line_procurement')      as m8_qualification,
  exists (select 1 from information_schema.tables
          where table_schema='public' and table_name='logistics_lines')       as m9_socle_logistique;
```

**Attendu avant la phase 1** : `m1` à `m7` = `true`, `m8` selon que vous
l'avez appliquée, `m9` = `false`.
Si `m8` est `false`, appliquez d'abord `20260814000800_set_line_procurement.sql`.

## Étape 1 — Comptage AVANT (à conserver)

```sql
select
  (select count(*) from public.organizations)      as organisations,
  (select count(*) from public.stores)             as magasins,
  (select count(*) from public.warehouses)         as depots,
  (select count(*) from public.profiles)           as profils,
  (select count(*) from public.customers)          as clients,
  (select count(*) from public.products)           as produits,
  (select count(*) from public.product_variants)   as variantes,
  (select count(*) from public.suppliers)          as fournisseurs,
  (select count(*) from public.orders)             as commandes,
  (select count(*) from public.order_lines)        as lignes_commande,
  (select count(*) from public.payments)           as reglements,
  (select count(*) from public.shipments)          as transports,
  (select count(*) from public.approval_requests)  as validations,
  (select count(*) from public.activity_logs)      as historique;
```

**Faites une capture d'écran du résultat.** Elle servira de preuve à
l'étape 6 qu'aucune donnée n'a bougé.

## Étape 2 — Sauvegarde

1. Dashboard Supabase → **Database → Backups** : noter la date de la
   dernière sauvegarde automatique (si votre offre en propose).
2. Filet supplémentaire recommandé : pour chaque table ci-dessus, exécuter
   `select * from public.<table>;` puis **Download CSV**. Ranger les
   fichiers dans un dossier daté.

## Étape 3 — Appliquer la migration

1. Ouvrir le fichier brut sur GitHub :
   `supabase/migrations/20260819000900_socle_logistique.sql`
2. Tout copier → SQL Editor → nouvelle requête → coller → **Run**.
3. Résultat attendu : `Success. No rows returned`.
   *(Des messages « NOTICE … does not exist, skipping » sont normaux : ils
   viennent des instructions rejouables.)*
4. En cas d'erreur rouge : **arrêtez-vous** et transmettez le message tel
   quel. La migration est encadrée par une transaction — en cas d'échec,
   rien n'est appliqué.

> La migration est **rejouable** : une seconde exécution accidentelle
> affiche « migration 9 déjà appliquée » et ne crée aucun doublon.

## Étape 4 — Vérifier la migration

```sql
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name in (
       'recap_sources','recap_reads','logistics_lines','logistics_line_events',
       'delivery_jobs','delivery_allocations','skara_documents',
       'skara_document_extractions','skara_document_corrections',
       'match_candidates','logistics_anomalies','sync_events',
       'sensitive_access_logs'))                                   as tables_creees_attendu_13,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relrowsecurity and c.relname in (
       'recap_sources','recap_reads','logistics_lines','logistics_line_events',
       'delivery_jobs','delivery_allocations','skara_documents',
       'skara_document_extractions','skara_document_corrections',
       'match_candidates','logistics_anomalies','sync_events',
       'sensitive_access_logs'))                                   as rls_active_attendu_13,
  (select count(*) from information_schema.role_table_grants
     where table_schema='public' and grantee in ('anon','authenticated')
       and table_name in (
       'recap_sources','recap_reads','logistics_lines','logistics_line_events',
       'delivery_jobs','delivery_allocations','skara_documents',
       'skara_document_extractions','skara_document_corrections',
       'match_candidates','logistics_anomalies','sync_events',
       'sensitive_access_logs'))                                   as droits_directs_attendu_0,
  (select count(*) from information_schema.role_table_grants
     where table_schema='public' and table_name='product_variants'
       and grantee in ('anon','authenticated') and privilege_type='UPDATE')
                                                                   as update_catalogue_attendu_0,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in (
       'logistics_summary','set_variant_logistics',
       'allocate_to_delivery_job','get_delivery_job'))              as rpc_attendu_4,
  (select count(*) from information_schema.routine_privileges
     where routine_schema='public' and grantee in ('anon','PUBLIC')
       and routine_name in (
       'logistics_summary','set_variant_logistics',
       'allocate_to_delivery_job','get_delivery_job'))              as execute_anon_attendu_0,
  (select coalesce(array_length(app.role_permissions('livreur'),1),0))
                                                                   as permissions_livreur_attendu_0;
```

Toutes les valeurs doivent correspondre aux noms des colonnes
(13, 13, 0, 0, 4, 0, 0).

## Étape 5 — Créer le bucket privé

Supabase → **Storage → New bucket** :

* nom : `documents-skara` ;
* **décocher « Public bucket »** — le bucket doit rester **privé** ;
* créer.

Ce bucket accueillera les factures/bons de livraison à partir de la phase 3.
Aucun fichier n'y est déposé en phase 1.

## Étape 6 — Comptage APRÈS

Réexécuter **exactement** la requête de l'étape 1. Les chiffres doivent être
**identiques** à la capture d'écran conservée. Toute différence est
anormale : signalez-la.

## Étape 7 — Déploiement

Vercel → **Deployments** : attendre que le déploiement du commit de phase 1
soit `Ready`. Puis, dans l'application :

* le menu affiche **Logistique** et **Archives** ; les modules commerciaux
  ont quitté le menu principal ;
* la page **Logistique** affiche « Socle en place » et des compteurs à 0 ;
* **Référentiel produits** propose le bouton « Logistique » sur chaque
  variante ;
* **Paramètres › Archives** liste les 5 modules déplacés, tous ouvrables.

## Attribution des nouveaux rôles (optionnel)

```sql
-- Responsable logistique
update public.profiles set role = 'responsable_logistique'
where id = (select id from auth.users where email = 'personne@exemple.fr');

-- Livreur (aucun accès en phase 1 : ses droits s'ouvriront en phase 6)
update public.profiles set role = 'livreur'
where id = (select id from auth.users where email = 'livreur@exemple.fr');
```

## Retour arrière

Voir `supabase/rollbacks/ROLLBACK_20260819000900_socle_logistique.sql` et
**lire son avertissement en tête** : il n'est sûr que tant que les 13 tables
sont vides. Le retour arrière applicatif se fait dans Vercel en promouvant
le déploiement précédent.
