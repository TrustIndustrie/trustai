# Paniers abandonnés

Ce document décrit le **lot A** : collecter les paniers abandonnés Shopify,
les rendre visibles dans TRUST AI, et fermer automatiquement ceux qui
aboutissent à une commande. **Aucun message n'est envoyé** par ce lot.

## Pourquoi une lecture et non un webhook

Shopify n'émet **aucun** événement « panier abandonné » : l'abandon est une
absence d'événement. Les sujets `checkouts/create` et `checkouts/update`
livreraient chaque étape de tunnel, en grand volume, et nous laisseraient
décider nous-mêmes du moment de l'abandon.

TRUST AI lit donc périodiquement la liste que Shopify tient déjà. Le champ
décisif est l'**adresse de récupération** : elle ne peut pas être
reconstruite. Sans elle, une relance renverrait le client vers un panier
vide.

## Deux prérequis qui ne sont pas du code

1. **Périmètre `read_orders`** sur l'application Shopify. Il est déjà
   demandé pour les commandes.
2. **Accès aux données client protégées.** Lire l'adresse, le téléphone et le
   nom d'un panier abandonné relève des « protected customer data » de
   Shopify et demande une approbation dans la configuration de
   l'application. Sans elle, ces champs reviennent **vides**.

Le code ne s'en plaint pas et ne devine rien : le panier est alors
enregistré **sans contact**, donc non relançable, et reste visible avec la
mention correspondante. La collecte, l'attribution et les montants
fonctionnent sans cette approbation.

## La règle de consentement, tenue par la base

Un panier n'est relançable que si Shopify indique un **consentement
marketing explicite**. La décision est prise dans PostgreSQL, par
`app.abandoned_checkout_status`, et non par l'interface :

| Situation | Statut | Relançable |
|---|---|---|
| Aucune adresse transmise | `sans_contact` | non |
| Adresse, consentement absent ou inconnu | `sans_consentement` | non |
| Adresse, refus explicite | `sans_consentement` | non |
| Adresse désinscrite | `exclu` | non |
| Adresse et consentement | `a_relancer` | oui |
| Commande reçue avec le même jeton | `recupere` | sans objet |

Aucun bouton de l'interface ne permet de passer outre. Une réintégration
**recalcule** le statut : elle ne le restaure pas. Un panier sans
consentement réintégré reste `sans_consentement`, et une adresse désinscrite
est refusée.

## Ce qui ferme un panier tout seul

La commande porte le **jeton de tunnel** que porte aussi le panier. Dès
qu'une commande arrive avec ce jeton, un déclencheur PostgreSQL passe le
panier en `recupere`, trace l'événement et **annule les messages encore
planifiés**. L'attribution est donc atomique et vaut pour tout écrivain, y
compris la réception de webhook côté serveur.

Le jeton est extrait de l'adresse de récupération : Shopify ne l'expose pas
sur l'objet GraphQL du checkout, mais l'adresse le contient.

## Déclencher une lecture

### À la main, par un administrateur

Page **Paniers abandonnés** → bouton « Lire les paniers Shopify ». Ou
directement :

```
POST https://trustai-omega.vercel.app/api/shopify/abandoned-checkouts/sync
```

La permission `administrer` est vérifiée côté serveur, puis rejouée par la
base. Le paramètre `?jours=` limite la fenêtre lue (14 jours par défaut, 90
au plus).

### Automatiquement

`vercel.json` déclare une tâche planifiée horaire sur la même route, en
`GET`. Deux points à connaître :

- la tâche exige la variable d'environnement **`CRON_SECRET`** ; sans elle,
  la route répond 503 et ne fait rien. Vercel envoie ce secret dans l'en-tête
  `Authorization` ;
- la granularité des tâches planifiées dépend du plan Vercel de l'équipe. Une
  lecture horaire suppose mieux qu'un déclenchement quotidien.

Sans session, l'écriture passe par la clé de service et l'organisation est
explicite. Ce chemin n'élargit aucun droit : la clé de service contourne déjà
la RLS.

## Idempotence

La clé est le couple organisation et identifiant de checkout. Deux lectures
identiques ne créent pas de doublon, et une lecture **ne revient jamais sur
une décision** : un panier exclu par un humain ou déjà récupéré garde son
statut, seules ses données volatiles sont rafraîchies. Le rapport de lecture
distingue `created`, `updated` et `preserved`.

## Ce que le lot A ne fait pas

- Il n'envoie aucun message. Les tables `customer_messages` et
  `message_suppressions` existent, avec leur index d'unicité, mais rien ne
  les alimente : le lot suivant apporte le fournisseur d'envoi, la séquence
  et le lien de désinscription.
- Il ne planifie aucune relance.
- Il ne crée ni ne modifie aucun abonnement webhook Shopify.

## Retour arrière

`supabase/rollbacks/ROLLBACK_20260924001400_paniers_abandonnes.sql`, à
exécuter **avant** les retours arrière des migrations antérieures. Les
désinscriptions ne sont pas reconstituables depuis Shopify : exporter
`message_suppressions` avant de l'exécuter.
