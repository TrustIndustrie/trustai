# Connecter Shopify à TRUST AI — guide 2026 pas à pas

Ce guide suit le parcours Shopify actuel : une **application créée dans le
Dev Dashboard** (dev.shopify.com), qui obtient elle-même ses access tokens
(« Client Credentials Grant », renouvelés automatiquement toutes les 24 h)
et dont le **Client Secret** signe les webhooks. Plus besoin de token
permanent `shpat_` ni de webhooks créés à la main dans la section
Notifications.

Prérequis : le mode connecté Supabase fonctionne (`docs/SUPABASE_SETUP.md`).

> **Règle d'or** : le Client Secret et la clé Supabase sont des SECRETS
> SERVEUR. Ils se collent uniquement dans les variables d'environnement
> Vercel (jamais de préfixe `NEXT_PUBLIC_`), jamais dans le code, jamais
> dans une conversation.

## Ce que fait l'intégration

* **Commandes** : créations et mises à jour arrivent automatiquement par
  webhook — client réutilisé, articles rattachés au catalogue, montants en
  centimes, paiement en ligne net (« Shopify (en ligne) »), annulations et
  remboursements Shopify répercutés sans inventer d'opération financière,
  acquisition **mesurée** (première page, UTM, référent).
* **Catalogue** : produits/variantes par webhook au fil de l'eau + bouton
  « Synchroniser depuis Shopify » (import complet GraphQL, toutes les pages
  et toutes les variantes ; produits supprimés de Shopify **désactivés**,
  jamais effacés).
* **Sécurité** : signature HMAC vérifiée sur le corps brut (temps
  constant), domaine de boutique contrôlé (`X-Shopify-Shop-Domain`),
  idempotence par `X-Shopify-Webhook-Id`, écritures serveur uniquement.
* **Jamais écrasé** : le suivi d'approvisionnement saisi par l'équipe
  (statuts, fournisseurs, dépôts) n'est jamais modifié par un webhook.

## 1. Appliquer les migrations Shopify (4 à 7)

L'intégration Shopify a besoin des migrations `20260813000400` à
`20260814000700` (journal des webhooks, idempotence, SKU en doublon,
écritures groupées), en plus des migrations 1 à 3 du guide Supabase.

### Parcours A — sans rien installer (SQL Editor) ✅ recommandé

Pour chaque fichier de `supabase/migrations/` PAS ENCORE appliqué, **dans
l'ordre des noms de fichiers** : ouvre-le sur GitHub (bouton **Raw**),
copie tout, colle dans Dashboard Supabase → **SQL Editor** → **Run**.
Résultat attendu : `Success. No rows returned`. En cas d'erreur rouge,
arrête-toi et note le message.

Vérification (à coller telle quelle dans SQL Editor — tout doit être
`true`) :

```sql
select
  exists (select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'shopify_webhook_events')
    as migration_4,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'shopify_webhook_events'
            and column_name = 'webhook_id')
    as migration_5,
  exists (select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'product_variants_manual_sku_key')
    as migration_6,
  exists (select 1 from pg_constraint
          where conname = 'product_variants_shopify_id_key' and contype = 'u')
    as migration_7;
```

### Parcours B — avec le CLI Supabase (optionnel, pour développeurs)

```bash
npx supabase login
npx supabase link --project-ref PROJECT_REF   # Settings → General
npx supabase db push                          # applique ce qui manque
```

> **Migrations déjà appliquées via SQL Editor ?** Marque-les d'abord comme
> appliquées (`npx supabase migration repair --status applied
> <horodatage>` pour chacune), puis `npx supabase db push`. Vérification :
> `npx supabase migration list` doit montrer les 7 migrations des deux
> côtés (Local et Remote).

## 2. Variables Supabase côté serveur

Dashboard Supabase → Settings → **API Keys** → section **Secret keys** →
copie la clé `sb_secret_…`, puis dans **Vercel** → Environment Variables
(Production **et** Preview) :

| Key | Value |
| --- | --- |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` |

## 3. Créer l'application dans le Dev Dashboard Shopify

1. Va sur **https://dev.shopify.com** et connecte-toi avec le compte
   propriétaire de la boutique → choisis ton **organisation** ;
2. **Apps** → **Create app** → nom : `TRUST AI` ;
3. Dans l'app → **Versions / Configuration** → section **Access scopes** :
   ajoute les périmètres **`read_products`** et **`read_orders`**, puis
   **Release** la version si demandé ;
4. **Install** l'application sur ta boutique (menu de l'app → Install on
   store → sélectionne la boutique) ;
5. Onglet **Settings / Client credentials** de l'app : copie le
   **Client ID** et le **Client Secret**.

Dans **Vercel** → Environment Variables (Production **et** Preview) :

| Key | Value |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | domaine(s) technique(s), ex. `wn02qe-0w.myshopify.com` — voir ci-dessous |
| `SHOPIFY_CLIENT_ID` | le Client ID |
| `SHOPIFY_CLIENT_SECRET` | le Client Secret |
| `SHOPIFY_API_VERSION` | *(facultatif — défaut `2026-01`)* |

> ⚠️ **Attention au bon domaine** : le nom court visible dans l'URL de
> l'admin (`admin.shopify.com/store/ma-boutique`) n'est PAS toujours le
> domaine `.myshopify.com` réel de la boutique. Le domaine qui compte est
> celui que Shopify met dans l'en-tête `X-Shopify-Shop-Domain` de ses
> webhooks (souvent une suite de caractères, ex. `wn02qe-0w.myshopify.com`).
> Où le trouver :
>
> * admin Shopify → **Paramètres → Domaines** : le domaine non modifiable
>   en `.myshopify.com` ;
> * ou Dev Dashboard → ton app → **Surveillance / Journaux** → ouvre une
>   livraison de webhook → en-tête `X-Shopify-Shop-Domain`.
>
> En cas de doute, déclare **les deux** séparés par une virgule :
> `wn02qe-0w.myshopify.com,ma-boutique.myshopify.com`. C'est une liste
> blanche : seules ces boutiques sont acceptées, et le premier domaine
> sert aux appels à l'API Admin.

> ℹ️ **Pas de token à copier** : l'application demande elle-même ses access
> tokens à Shopify avec ces identifiants et les renouvelle automatiquement
> (le grant « client credentials » fonctionne parce que l'app et la
> boutique appartiennent à la même organisation).

> **Ancienne application personnalisée ?** Si tu avais déjà créé une app
> legacy dans l'admin de la boutique (token `shpat_`), elle reste supportée
> via `SHOPIFY_ADMIN_ACCESS_TOKEN` + `SHOPIFY_WEBHOOK_SECRET` — mais c'est
> un mode de compatibilité, à ne pas utiliser pour une nouvelle
> installation.

## 4. Protected customer data (obligatoire pour les commandes)

Les webhooks et l'API commandes contiennent des **données clients
protégées** (nom, e-mail, téléphone, adresse). Sans cette étape, Shopify
**expurge** ces champs et TRUST AI recevrait des commandes sans client.

1. Dev Dashboard → ton app → **API access** (ou Configuration → Data
   access) → section **Protected customer data access** ;
2. Clique **Request access** → sélectionne **Protected customer data**
   (niveau commande) puis les champs **Name**, **Email**, **Phone**,
   **Address** ;
3. Motif à indiquer : gestion interne des commandes et livraisons de la
   boutique par l'équipe Trust Industrie (usage interne, pas de revente de
   données) ;
4. Pour une app d'organisation installée sur ta propre boutique,
   l'auto-déclaration suffit — pas de revue externe.

## 5. Redéployer, puis créer les abonnements webhooks depuis TRUST AI

1. Vercel → Deployments → **Redeploy** (les variables ne s'appliquent
   qu'aux nouveaux builds) ;
2. Connecte-toi à TRUST AI en administrateur → page **Mon compte** →
   carte **« Intégration Shopify — abonnements webhooks »** ;
3. **Vérifier les abonnements** → les 4 sujets requis s'affichent
   (`ORDERS_CREATE`, `ORDERS_UPDATED`, `PRODUCTS_CREATE`,
   `PRODUCTS_UPDATE`) avec leur état ;
4. **Créer les abonnements manquants** → l'application les enregistre
   auprès de Shopify via l'API Admin GraphQL, sans doublon, vers l'URL
   publique de l'application.

(L'autorisation est vérifiée côté serveur : seul un profil
« administrateur » peut lister ou créer les abonnements, et rien n'est
créé automatiquement au chargement d'une page.)

## 6. Tester

1. **Catalogue** : page Catalogue → « Synchroniser depuis Shopify » → ton
   catalogue réel s'importe (produits « Shopify », date de synchronisation,
   archivés Shopify → inactifs) ;
2. **Commande** : passe une commande de test dans la boutique → elle
   apparaît dans TRUST AI (onglet Shopify) avec client, articles, paiement
   en ligne et source d'acquisition mesurée ;
3. **Annulation** : annule la commande de test dans Shopify → elle passe
   « Annulée » dans TRUST AI ; si elle est remboursée, l'encaissement en
   ligne est retiré du suivi (journalisé), sans opération inventée.

## Dépannage

* **401 « Signature HMAC invalide »** : le `SHOPIFY_CLIENT_SECRET` ne
  correspond pas à l'app qui a créé les webhooks (secret régénéré ? app
  différente ?). Après rotation du secret, Shopify peut mettre jusqu'à une
  heure à signer avec la nouvelle valeur.
* **401 « Boutique émettrice inattendue »** : `SHOPIFY_STORE_DOMAIN` ne
  correspond pas au domaine `*.myshopify.com` réel de la boutique. Le
  message d'erreur indique le domaine reçu : ajoute-le à la variable
  (plusieurs domaines possibles, séparés par des virgules) et redéploie.
  Les webhooks refusés sont automatiquement **retentés par Shopify pendant
  48 h** : les commandes rejetées entre-temps arrivent d'elles-mêmes une
  fois la correction déployée.
* **503** : une variable manque — vérifie l'orthographe exacte dans Vercel
  et redéploie.
* **Échec d'authentification (HTTP 4xx) lors de la synchronisation** :
  Client ID/Secret erronés, ou l'app n'est pas **installée** sur la
  boutique, ou app et boutique ne sont pas dans la même organisation.
* **Commandes sans nom/e-mail client** : l'accès « Protected customer
  data » n'a pas été déclaré (étape 4).
* **Débogage fin** : table `shopify_webhook_events` (SQL Editor) :
  `select topic, status, error, received_at from shopify_webhook_events
  order by received_at desc limit 20;` — Shopify retente automatiquement
  les livraisons en échec pendant 48 h ; les re-livraisons du même
  événement sont ignorées (idempotence par webhook_id).
* **Retour arrière** : supprime les abonnements webhooks (Dev Dashboard →
  app → Webhooks, ou en vidant les variables et en redéployant) ;
  l'application fonctionne normalement sans Shopify.

## Limites volontaires de cette phase

* Shopify est en LECTURE seule (aucune écriture vers Shopify) ;
* le traitement comptable des remboursements/avoirs magasin reste une
  phase dédiée ;
* volumétrie : l'import complet par pagination GraphQL convient jusqu'à
  ~10 000 produits ; au-delà, prévoir les Bulk Operations (non nécessaire
  pour Trust Industrie) ;
* WhatsApp et OpenAI restent non connectés.
