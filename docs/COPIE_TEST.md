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

À chaque synchronisation, pour chaque ligne :

1. si l'original porte déjà un `ID TRUST` (ancien script `id-trust.gs`
   installé avant cette règle), il est recopié tel quel ;
2. sinon, l'identifiant que la copie TEST avait attribué à une ligne de **même
   contenu** est conservé, même si la ligne a été déplacée ou triée ;
3. sinon, un identifiant neuf est généré.

Deux lignes strictement identiques reçoivent chacune leur identifiant, dans
l'ordre du fichier. Une ligne **modifiée** (désignation corrigée, quantité
changée…) est vue comme une ligne nouvelle : elle reçoit un identifiant neuf,
et TRUST AI signale l'ancienne comme « absente du fichier » plutôt que de la
supprimer. C'est la limite de l'identification par contenu, et le prix de ne
rien écrire dans l'original.

Si un jour l'équipe accepte une colonne technique dans l'original, le script
`id-trust.gs` (une écriture, dans cette seule colonne) rend les identifiants
stables même en cas de modification ; le script de synchronisation les
recopie alors sans rien changer.

L'onglet **SYNCHRO** de la copie TEST journalise chaque passage : nombre de
lignes, identifiants recopiés, conservés, générés. Un nombre élevé
d'identifiants *générés* à chaque passage signale un problème (colonne
`ID TRUST` supprimée dans la copie, onglet renommé…).

---

## Ce que le script ne fait pas

- il n'écrit jamais dans l'original ;
- il ne supprime pas de lignes dans la copie : il remplace le contenu des
  onglets suivis, et laisse la mise en forme en place ;
- il ne touche pas aux onglets de la copie qui ne sont pas dans `SYNC_SHEETS`
  (sauf l'onglet journal `SYNCHRO`) ;
- il n'envoie rien à l'extérieur.
