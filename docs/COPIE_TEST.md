# La copie TEST du récapitulatif

**Règle impérative : aucune écriture dans le Google Sheet original.**

| Fichier | Qui y écrit | Qui le lit |
|---|---|---|
| **ORIGINAL** | l'équipe (vendeuses, logistique), comme avant | le script de synchronisation, en lecture |
| **Copie TEST** | uniquement le script `synchroniserOriginalVersTest` | TRUST AI, en lecture seule (compte de service) |

Le script vit **dans la copie TEST**. Il ouvre l'original par son identifiant,
lit ses onglets, et recopie leurs valeurs dans la copie. Sur l'original, il
n'appelle que des fonctions de lecture ; une garde l'empêche même de
s'exécuter s'il est installé par erreur dans l'original.

---

## Installation (dans le navigateur, sans terminal)

1. **Créer la copie TEST** : ouvrir l'original → menu **Fichier** → **Créer une
   copie**. La nommer par exemple `RECAP — COPIE TEST (TRUST AI)`. Cette copie
   conserve la mise en forme (formats de dates, largeurs), c'est voulu.
2. **Noter l'identifiant de l'original** : dans son adresse, la suite de
   caractères entre `/d/` et `/edit`.
3. **Dans la copie TEST** : menu **Extensions** → **Apps Script**. Effacer
   `Code.gs` et coller tout le contenu de
   [`google-apps-script/synchroniser-original-vers-test.gs`](../google-apps-script/synchroniser-original-vers-test.gs).
4. En haut du script :
   - `ORIGINAL_SPREADSHEET_ID` : l'identifiant noté à l'étape 2 ;
   - `SYNC_SHEETS` : les onglets à recopier (`INTERNET`, `SUIVIS 2025`, …) et la
     ligne des titres (4 pour le récapitulatif de Trust Industrie).
5. **Enregistrer**, choisir `synchroniserOriginalVersTest` dans la liste
   déroulante, **Exécuter**, **Autoriser**. Les onglets se remplissent.
6. Recharger la copie TEST : un menu **TRUST AI** apparaît. Cliquer
   **Activer la synchronisation automatique (15 min)**.
7. **Partager la copie TEST en lecteur** avec le compte de service de TRUST AI,
   et renseigner **son** identifiant (pas celui de l'original) dans TRUST AI,
   page *Configurer le récapitulatif*. Le reste de
   [`RECAP_GOOGLE_SHEETS.md`](RECAP_GOOGLE_SHEETS.md) s'applique tel quel.

Si le compte de service était partagé sur l'original, **retirer ce partage** :
TRUST AI ne doit connaître que la copie.

---

## Les identifiants « ID TRUST »

TRUST AI reconnaît une ligne d'une lecture à l'autre grâce à la colonne
`ID TRUST`. Avec la copie TEST, cette colonne est gérée **dans la copie**, par
le script de synchronisation. Aucun script n'est nécessaire dans l'original.

**Une empreinte ne garantit pas une identité.** Sans identifiant écrit à la
source, le script ne peut que *reconnaître* une ligne à son contenu. Il le
fait avec des règles explicites, dans cet ordre, à chaque synchronisation :

1. **Recopie** : si l'original porte déjà un `ID TRUST` (ancien script
   `id-trust.gs`), il est repris tel quel. Un identifiant dupliqué par
   copier-coller n'est repris qu'une fois.
2. **Conservation** : une ligne dont les **colonnes clés** sont identiques à
   une ligne de la copie TEST reprend son identifiant. Les colonnes clés sont
   `DATE DU RECAP`, `NOM DU FOURNISSEUR`, `REF FOURNISSEUR ARTICLES`,
   `MARCHANDISES`, `QUANTITE`, la colonne client (`G`) et `ORDER`
   (liste `SYNC_KEY_COLUMNS` en haut du script). Tout le reste, commentaires,
   réceptions, statuts, dates de livraison, **vit au quotidien sans changer
   l'identifiant**.
3. **Rapprochement** : une ligne qui ne diffère que par **une** colonne clé
   d'une ancienne ligne encore libre (quantité corrigée, faute de frappe dans
   la désignation…) reprend son identifiant, à condition qu'il n'y ait qu'un
   seul candidat plausible. Dans le doute, le script ne devine pas.
4. **Génération** : sinon, identifiant neuf.

Ce que cela donne concrètement :

| Geste dans l'original | Effet sur l'identifiant |
|---|---|
| Commentaire, réception, statut, date de livraison modifiés | conservé |
| Tri, déplacement d'une ligne | conservé |
| Insertion d'une ligne | la nouvelle reçoit un identifiant, les autres gardent le leur |
| Suppression d'une ligne | les autres gardent le leur ; TRUST AI signale la ligne absente, ne la supprime pas |
| Une colonne clé corrigée | conservé si le rapprochement est sans ambiguïté |
| Deux colonnes clés ou plus modifiées | **ligne nouvelle** : ancien identifiant orphelin, l'ancienne ligne est signalée absente |
| Lignes strictement identiques | chacune garde son identifiant, dans l'ordre du fichier ; si l'une disparaît, c'est la dernière qui est libérée |

La dernière ligne du tableau est la limite réelle : deux lignes identiques ne
sont distinguables que par leur ordre. Seule une colonne technique écrite
**dans l'original** (script `id-trust.gs`, une écriture dans cette seule
colonne) lève cette limite. Si l'équipe l'accepte un jour, le script de
synchronisation recopiera ces identifiants sans rien changer d'autre.

L'onglet **SYNCHRO** de la copie TEST journalise chaque passage : lignes,
identifiants recopiés, conservés, rapprochés, générés. Un nombre élevé
d'identifiants *générés* à chaque passage signale un problème (colonne
`ID TRUST` supprimée dans la copie, onglet renommé, colonnes clés
introuvables).

Ces règles sont prouvées par `src/lib/recap/apps-script.test.ts`, qui exécute
la logique du script dans un bac à sable : modification de champ vivant,
modification d'une ou deux colonnes clés, tri, insertion, suppression, lignes
identiques, rapprochement ambigu.

---

## Ce que le script ne fait pas

- il n'écrit jamais dans l'original ;
- il ne supprime pas de lignes dans la copie : il remplace le contenu des
  onglets suivis, et laisse la mise en forme en place ;
- il ne touche pas aux onglets de la copie qui ne sont pas dans `SYNC_SHEETS`
  (sauf l'onglet journal `SYNCHRO`) ;
- il n'envoie rien à l'extérieur.
