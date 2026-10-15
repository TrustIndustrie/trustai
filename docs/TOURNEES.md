# Tournées de livraison (lot 2B)

## Ce que ce lot ajoute

Le lot 2A donne la date : un dossier devient livrable, un responsable autorise
le contact, un créneau est convenu avec le client. Le lot 2B **tient** cette
date — regrouper les créneaux confirmés d'une journée, au départ d'un dépôt,
dans un ordre de passage.

## La règle qui justifie tout le reste

> On ne met pas dans la tournée du mardi un client à qui on a promis le lundi.

Un passage ne s'ajoute que si **la date de la tournée est exactement celle du
créneau retenu**, et que le dépôt de départ est le même. Sans ce contrôle,
l'outil permettrait de construire proprement une tournée qui trahit la
promesse faite au client — ce qui est pire que pas d'outil du tout.

Cinq conditions sont vérifiées à chaque ajout :

| Condition | Pourquoi |
|---|---|
| un créneau est retenu | on ne charge pas un client qu'on n'a pas appelé |
| la date promise = la date de la tournée | la promesse prime sur la commodité |
| même dépôt de départ | c'est là qu'on charge le camion |
| la marchandise est toujours disponible | elle a pu bouger depuis l'appel |
| pas déjà prévu dans une autre tournée vivante | un client, un camion |

La quatrième mérite une explication : entre le moment où le client dit oui et
celui où l'on charge, le récapitulatif a pu changer. La disponibilité est donc
**revérifiée au chargement**, pas seulement à la promesse.

## Le cycle d'une tournée

```
brouillon → planifiee → en_cours → terminee
```

* **brouillon** : on compose, rien n'est engagé.
* **planifiee** : exige un livreur affecté **et** au moins un passage. Les
  dossiers concernés passent à « planifié ». Sans ces deux conditions, la
  tournée n'engagerait rien et le mot serait faux.
* **en_cours** : le camion est parti ; les dossiers passent à « en cours ».
* **terminee** : la tournée se referme **d'elle-même** quand le dernier
  passage a reçu son résultat.

## Résultat d'un passage

**Livré.** Le dossier est terminé, ses affectations passent à « livrée », la
marchandise sort du stock et un événement daté le consigne. Rien de tout cela
n'est déductible plus tard : c'est maintenant ou jamais.

**Échec ou report.** Un motif est **obligatoire**. Le dossier retourne à
« prêt à contacter » et le créneau promis devient caduc. C'est le comportement
honnête : une date manquée n'est plus une date, et il faut rappeler le client.

Un passage déjà soldé ne se resaisit pas, et ne se retire plus de la tournée :
il fait partie de l'historique.

## L'ordre de passage

L'ordre est le plan de route du livreur. Le réordonner exige une liste
**complète et sans doublon** : un ordre partiel laisserait des passages à une
position arbitraire.

Détail d'implémentation visible dans le code : un index unique n'étant pas
différable, la réorganisation décale d'abord toutes les positions d'un millier
avant d'écrire les définitives. Sans ce détour, l'échange de deux passages
violerait l'index en cours de route.

Retirer un passage **referme les positions** : un plan de route troué fait
douter le livreur de sa liste.

## Ce que ce lot n'ouvre pas

**Les droits du rôle `livreur`**, qui reste sans aucune permission.

Le socle liait leur ouverture à une phase dédiée, avec ses propres tests de
sécurité au niveau des lignes. Donner un accès terrain est une décision à
part, pas un effet de bord des tournées : il faut choisir ce qu'un livreur
voit (ses tournées seulement), ce qu'il peut écrire, et si les montants à
encaisser lui sont visibles.

En attendant, les résultats de passage se saisissent **au bureau**, sous
`executer_livraison`, que le responsable logistique détient déjà.

## Retour arrière

`supabase/rollbacks/ROLLBACK_20261015001900_tournees_livraison.sql`

Il perd les tournées, leurs passages et les résultats saisis. Il **ne défait
pas**, volontairement, les conséquences des livraisons déjà enregistrées : une
marchandise sortie du stock est sortie, une affectation livrée reste livrée,
un dossier terminé reste terminé. Ce sont des faits, pas des états techniques.

Il rétablit aussi `app.org_of` dans sa forme antérieure, sans les deux cas
ajoutés par la migration 19.
