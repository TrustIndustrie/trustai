# Livraisons — disponibilité et créneaux (lot 2A)

## Le problème résolu

Le socle logistique nommait déjà toute la chaîne du dossier de livraison :

```
a_rapprocher → incomplet → pret_a_contacter → contact_en_cours
             → creneau_confirme → planifie → en_cours → termine
```

Mais **rien ne faisait jamais passer un dossier à `pret_a_contacter`**.
L'étape était comptée sur le tableau de bord sans qu'aucune fonction ne la
déclenche : le mot existait, le mécanisme non. La promesse de date au client
se tenait donc de tête, en croisant deux écrans.

## Ce que fait la migration 18

### La disponibilité, calculée et jamais stockée

Un dossier est prêt quand **toutes** ses lignes affectées sont disponibles
**dans le dépôt d'où part la livraison**. Une ligne déjà livrée compte comme
prête : lors d'une livraison partielle, seul le reliquat commande.

Ce résultat n'est pas enregistré. Il serait faux dès le prochain
rafraîchissement du récapitulatif. Il est recalculé à chaque lecture, par une
seule fonction, `app.delivery_readiness`, partagée par la liste et le détail —
deux implémentations divergeraient, et un écran annoncerait « prêt » quand
l'autre dit « incomplet ».

Quatre états :

| État | Signification |
|---|---|
| `complet` | toutes les lignes sont disponibles au bon dépôt |
| `partiel` | une partie seulement |
| `rien_de_dispo` | aucune ligne disponible |
| `sans_ligne` | aucune marchandise affectée au dossier |

`sans_ligne` existe pour une raison précise. Sur un ensemble vide, « toutes
les lignes sont prêtes » est vrai et parfaitement faux. Le cas est traité
avant tout autre, et la suite de tests le vérifie explicitement.

### La validation humaine

Autoriser le contact d'un client exige **`gerer_livraisons` ET
`valider_decision`**.

* L'agent logistique (rôle `logistique`) prépare le dossier, voit la
  disponibilité, enregistre les créneaux. Il ne détient pas
  `valider_decision` : il **ne peut pas** ouvrir le contact.
* Le responsable logistique, la direction et l'administrateur le peuvent.

Une disponibilité partielle n'est pas refusée, elle est **assumée** : il faut
l'autoriser explicitement, et le dossier en garde la trace
(`contact_authorized_partial`). La livraison partielle est un cas réel, mais
elle se décide, elle ne se subit pas.

### Les créneaux

| Fonction | Ce qu'elle fait |
|---|---|
| `authorize_delivery_contact` | ouvre le contact, trace qui et quand |
| `propose_delivery_slots` | enregistre 1 à 5 créneaux à proposer |
| `confirm_delivery_slot` | le client accepte ; les autres tombent |
| `decline_delivery_slots` | refus motivé ; le dossier revient au contact |

Trois fenêtres seulement : `matin`, `apres_midi`, `journee`. Une heure précise
serait une promesse qu'une tournée ne peut pas tenir.

Reproposer ne supprime rien : les créneaux en attente deviennent `caduque`.
Ce qui a été proposé un jour reste lisible.

Un refus conserve l'autorisation de contact : inutile de revalider pour
proposer autre chose.

## TRUST AI n'envoie rien

`propose_delivery_slots` **enregistre** les créneaux qu'un humain proposera,
par téléphone ou par message. Aucune notification, aucun courriel, aucun appel
à un service extérieur. C'est la règle posée pour tout le projet, et elle
s'applique ici comme ailleurs. L'écran le dit au lieu de le laisser deviner.

Cette migration ne touche pas non plus au Google Sheet, dans aucun sens.

## Pourquoi aucun cloisonnement par magasin ici

La migration 17 a cloisonné les lectures Skara par magasin : un responsable de
magasin n'a pas à lire le chiffre d'affaires d'un autre.

La logistique est l'inverse. Elle sert les trois magasins depuis les dépôts,
et `gerer_livraisons` n'est détenue que par des rôles transverses — logistique,
responsable logistique, direction, administrateur — dont aucun n'a de magasin
accordé dans `user_store_access`. Cloisonner ici **viderait leurs écrans** au
lieu de protéger quoi que ce soit.

La permission est le cloisonnement. Ne pas « corriger » ce point.

## Retour arrière

`supabase/rollbacks/ROLLBACK_20261015001800_livraison_disponibilite_creneaux.sql`

**C'est le seul retour arrière de la série qui perd des données** : la table
des créneaux disparaît, donc les dates promises aux clients avec elle. Les
dossiers avancés jusqu'à « créneau confirmé » sont ramenés à « prêt à
contacter », faute de créneau pour les justifier. Exportez `delivery_slots`
avant de l'exécuter si ces dates comptent encore.

## Ce qui reste à faire

Les **tournées** : regrouper les créneaux confirmés par jour, par dépôt et par
livreur. Le socle l'a délibérément remis à plus tard — il est écrit dans la
migration 9 qu'aucune référence vers une table de passage n'a été créée, pour
ne pas préjuger de sa forme. Le terrain est propre.
