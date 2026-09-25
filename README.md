# TRUST AI

Application interne de Trust Industrie pour centraliser les commandes
(Shopify et magasin), le suivi des fournisseurs, les relances du lundi, les
arrivages, les mouvements entre dépôts, les livraisons/retraits clients, les
règlements et les restes à payer (RAP), ainsi que la provenance marketing des
commandes.

L'application fonctionne selon **deux modes clairement séparés** :

* **Mode démonstration** (aucune variable d'environnement) : données
  entièrement fictives dans le `localStorage` du navigateur, aucune
  authentification, badge « Mode démonstration ». Le build fonctionne sans
  aucune variable.
* **Mode connecté** (variables Supabase présentes) : Supabase est la source
  de vérité — base partagée, authentification obligatoire, un compte par
  employé, identité automatique de la vendeuse/du vendeur, droits par rôle
  et par magasin vérifiés côté serveur (RLS + fonctions RPC PostgreSQL).
  Voir **docs/SUPABASE_SETUP.md** pour l'activer pas à pas.

> Les données de démonstration ne sont JAMAIS recopiées automatiquement vers
> Supabase. WhatsApp et OpenAI ne sont pas encore connectés.

En mode connecté, **Shopify** peut être branché (phase 3) : commandes
reçues automatiquement par webhooks signés (HMAC), catalogue synchronisé
(webhooks + bouton d'import), clients et acquisition mesurée (UTM, première
page) — en lecture seule, sans jamais écraser le suivi d'approvisionnement
saisi par l'équipe. Voir **docs/SHOPIFY_SETUP.md**.

Le module **Logistique** pilote les marchandises à partir du **fichier
récapitulatif Google Sheets**, lu en **lecture seule** côté serveur : arrivées,
transfert Argenteuil → Aubagne, disponibilité, anomalies. Rien n'est demandé de
plus aux vendeuses, et TRUST AI n'écrit jamais dans le fichier. Voir
**docs/RECAP_GOOGLE_SHEETS.md** (parcours entièrement navigateur) et
**docs/PHASE1_SOCLE_LOGISTIQUE.md** pour le socle de données.

## Démarrer

```bash
npm install
npm run dev       # http://localhost:3000
npm run lint      # vérification ESLint
npm run test      # tests unitaires métier (vitest)
npm run build     # build de production (aucune variable d'environnement requise)
```

L'application se compile et fonctionne sur Vercel **sans aucune variable
d'environnement** (mode démonstration). Pour le mode connecté, seules deux
variables publiques sont nécessaires (`NEXT_PUBLIC_SUPABASE_URL` et
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — jamais de secret key ni de service
role key côté client. Le fichier `.env.example` liste les variables (toutes
vides).

### Rôles et permissions (mode connecté)

| Rôle | Périmètre |
| --- | --- |
| `vendeur` | Commandes et règlements de son magasin, identité automatique |
| `responsable_magasin` | Son/ses magasins + validations (jamais sa propre demande d'annulation) |
| `achats` | Catalogue, fournisseurs, commandes fournisseurs, relances |
| `logistique` | Arrivages, dépôts, réceptions (pas d'encaissements détaillés) |
| `comptabilite` | Encaissements, règlements, RAP |
| `direction` | Lecture complète, finances, validations, tous magasins |
| `administrateur` | Accès complet + gestion des utilisateurs |

La matrice vit dans `src/lib/types.ts` (`ROLE_PERMISSIONS`) et est **dupliquée
dans PostgreSQL** (`app.role_permissions`, migrations Supabase) — un test
vérifie que les deux restent synchronisées. Les restrictions sont appliquées
par Row Level Security et par les fonctions RPC : masquer un bouton n'est
jamais la sécurité.

## Pages

| Route | Rôle |
| --- | --- |
| `/dashboard` | Vue d'ensemble : commandes du jour, validations, relances, arrivages en retard, RAP, encaissements, alertes |
| `/commandes` | Liste des commandes (recherche, filtres, onglets Toutes / Shopify / Magasin) |
| `/commandes/nouvelle-magasin` | Formulaire complet de commande magasin (multi-articles, multi-règlements, RAP calculé) |
| `/commandes/[id]` | Fiche commande : suivi fournisseur par article, paiements, parcours logistique en timeline, acquisition, historique, validations |
| `/catalogue` | Catalogue centralisé des produits et variantes (SKU, prix, fournisseurs, synchronisation Shopify simulée) |
| `/validations` | File des demandes de validation humaine (Valider / Refuser, motif, impact financier) |
| `/achats` | Propositions de commandes fournisseurs regroupées par fournisseur, validation humaine obligatoire |
| `/relances` | File des relances fournisseurs du lundi, avec proposition de message |
| `/arrivages` | Transports et arrivages par dépôt et statut, réception partielle possible |
| `/fournisseurs` | Liste et fiches détaillées des fournisseurs |
| `/encaissements` | Récapitulatif par date, magasin, vendeuse/vendeur et moyen de paiement |
| `/acquisition` | Provenance marketing des commandes (sources, première page visitée, UTM) |

## Architecture

```
src/
  lib/
    types.ts              # Modèle de données complet (Store, Warehouse, Order,
                          # OrderLine, Supplier, ProductSupplier, SupplierOrder,
                          # Shipment, ShipmentLeg, Payment, AcquisitionJourney,
                          # ApprovalRequest, ActivityLog…)
    labels.ts             # Libellés français + tonalités de badges
    format.ts             # Dates françaises, euros, calcul du prochain lundi
    derive.ts             # Valeurs calculées : totaux, RAP, statut de paiement,
                          # file des relances (jamais stockées, toujours dérivées)
    seed.ts               # Données de démonstration fictives (10 scénarios)
    config.ts             # Détection du mode (démo / connecté Supabase)
    permissions.ts        # Matrice de permissions côté interface
    supabase/             # Clients navigateur + serveur (@supabase/ssr)
    auth/SessionProvider  # Session vérifiée (getUser) + profil employé
    repository/           # Interface DataRepository + localStorage (démo)
                          # + SupabaseRepository (instantané RLS + RPC atomiques)
    store/DataProvider.tsx# Contexte React : chargement hydratation-safe,
                          # actions métier, persistance via le repository
  components/
    layout/AppShell.tsx   # Barre latérale, menu mobile, en-tête, filtre magasin
    ui/                   # Badge, StatCard, EmptyState, LoadingState,
                          # ConfirmDialog, Toast
  app/                    # Pages (App Router)
```

Règles clés du prototype :

- **Aucun composant métier ne lit `localStorage` directement** : tout passe
  par `DataRepository` (versionné, avec **migration v1 → v2** qui conserve
  les commandes créées pendant la démo) via le `DataProvider`.
- Les **règles métier vivent dans `src/lib/mutations.ts`** (couche pure,
  testée par vitest) : un règlement doit être strictement positif, ne peut
  jamais dépasser le RAP, et une commande soldée n'accepte plus de
  règlement. Tous les calculs monétaires passent par des **centimes**
  (`src/lib/money.ts`).
- Le **RAP est toujours calculé** (`total − règlements`), jamais saisi. Le
  RAP global est la somme des RAP positifs **commande par commande** : un
  trop-perçu ne compense jamais le RAP d'une autre commande.
- Chaque **article d'une commande a son propre suivi** d'approvisionnement
  (fournisseur principal/alternatif, statut, arrivée prévue, dépôt, relances).
- Les **dépôts sont séparés des magasins** (Herblay est desservi par le dépôt
  d'Argenteuil sans que les deux entités soient fusionnées).
- Les **décisions importantes** (commande fournisseur, changement de
  fournisseur, annulation, affrètement…) passent par une **demande de
  validation humaine** ; aucune action extérieure réelle n'est exécutée.
- Un bouton dans la barre latérale **réinitialise les données de démo**.

## Architecture cible (phases suivantes)

1. **Shopify** (FAIT en phase 3) : webhooks `orders/create|updated` et
   `products/create|update` vérifiés par signature HMAC
   (`/api/webhooks/shopify`), synchronisation complète du catalogue via
   l'API Admin (`/api/shopify/sync-products`, réservée aux rôles catalogue),
   journal `shopify_webhook_events`, upserts idempotents.
2. **Supabase** (FAIT en V2) : schéma relationnel versionné dans
   `supabase/migrations`, RLS sur toutes les tables, fonctions RPC atomiques
   portant les règles métier V1.2, seed référentiel fictif, tests SQL dans
   `supabase/tests/rls_policies.test.sql`.
3. **OpenAI** proposera les fournisseurs alternatifs, les relances et les
   alertes (via `ProductSupplier` et l'historique d'activité).
4. **WhatsApp Business** pourra envoyer les messages fournisseurs **après
   validation humaine** (les propositions de messages existent déjà dans la
   page Relances).
5. Un **système d'authentification** (Supabase Auth) protégera l'application
   avant toute mise en production. Les types `UserProfile`, `Role` et
   `Permission` (`src/lib/types.ts`) sont prêts : à cette étape, **le choix
   manuel de la vendeuse/du vendeur dans les formulaires sera remplacé par
   l'utilisateur connecté** (nom et magasin renseignés automatiquement,
   droits selon le rôle, saisie « hors catalogue » réservée aux
   responsables). Cette connexion n'est pas un système de pointage : les
   horaires d'arrivée/départ seront une fonctionnalité distincte.

## Sécurité du prototype

- Données 100 % fictives (aucun nom, téléphone, adresse ou e-mail réel).
- `noindex, nofollow` dans les métadonnées + `robots.txt` bloquant
  l'indexation.
- Aucun secret stocké côté client ni dans le dépôt.
