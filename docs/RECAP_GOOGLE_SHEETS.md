# Brancher le récapitulatif Google Sheets sur TRUST AI

Ce guide se fait **entièrement dans le navigateur**. Aucun terminal, aucune
installation, aucune ligne de commande.

À la fin :

- TRUST AI **lit** le fichier récapitulatif, en **lecture seule** ;
- chaque ligne du fichier devient une ligne suivie dans TRUST AI : arrivée à
  Argenteuil, transfert vers Aubagne, disponibilité, et sortie chez le client
  par l'un des trois chemins que le fichier décrit ;
- **rien ne change pour les vendeuses** : elles continuent à remplir le
  fichier exactement comme aujourd'hui.

---

## Ce que TRUST AI fait — et ne fait pas

| TRUST AI | |
|---|---|
| Lit le fichier | ✅ oui, en lecture seule |
| Écrit dans le fichier | ❌ **jamais** — l'autorisation Google demandée ne le permet pas |
| Supprime une ligne | ❌ jamais. Une ligne qui disparaît du fichier est **signalée**, pas effacée |
| Devine une destination | ❌ jamais. Une destination non reconnue crée une **anomalie** à trancher par un humain |
| Demande un export quotidien aux vendeuses | ❌ jamais |

La seule chose écrite dans le Google Sheets l'est par un **petit script installé
dans le fichier lui-même** (étape 3), et uniquement dans une colonne technique
`ID TRUST`. TRUST AI n'y touche pas.

---

## Vue d'ensemble : 5 étapes

1. Créer un « compte de service » Google (l'identité que TRUST AI utilise pour lire).
2. Partager le Google Sheets **en lecteur** avec ce compte de service.
3. Installer le script `ID TRUST` dans le Google Sheets.
4. Renseigner les deux variables dans Vercel.
5. Configurer les onglets dans TRUST AI et prévisualiser.

Comptez 20 à 30 minutes la première fois.

---

## Étape 1 — Créer le compte de service Google

Un **compte de service**, c'est une adresse e-mail robot. On lui donne accès au
fichier comme à un collègue, sauf qu'elle appartient à l'application.

1. Aller sur <https://console.cloud.google.com/>.
2. En haut à gauche, ouvrir le sélecteur de projet → **Nouveau projet**.
   Nom : `TRUST AI`. → **Créer**. Attendre quelques secondes, puis
   **sélectionner** ce projet.
3. Dans la barre de recherche du haut, taper `Google Sheets API` →
   ouvrir le résultat → bouton **Activer**.
4. Barre de recherche → `Comptes de service` (ou *Service accounts*) →
   **Créer un compte de service**.
   - Nom : `trust-ai-lecture-recap`
   - **Créer et continuer** → l'étape « Accorder un rôle » n'est **pas**
     nécessaire : cliquer **Continuer**, puis **OK**.
5. La liste affiche maintenant une adresse du type
   `trust-ai-lecture-recap@trust-ai-123456.iam.gserviceaccount.com`.
   **Copiez-la et gardez-la de côté** : c'est `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
6. Cliquer sur le compte de service → onglet **Clés** → **Ajouter une clé** →
   **Créer une clé** → type **JSON** → **Créer**.
   Un fichier `.json` se télécharge.

> ⚠️ **Ce fichier JSON est un mot de passe.** Ne l'envoyez à personne, ne le
> collez dans aucune conversation (y compris avec Claude), ne le déposez pas
> dans le dépôt GitHub. Il servira une seule fois, à l'étape 4, puis pourra
> être supprimé de votre ordinateur.

---

## Étape 2 — Partager le fichier avec ce compte

1. Ouvrir le Google Sheets du récapitulatif.
2. Bouton **Partager** (en haut à droite).
3. Coller l'adresse du compte de service (celle de l'étape 1.5).
4. Choisir le rôle **Lecteur** — surtout pas Éditeur.
5. Décocher « Envoyer une notification » si l'option apparaît, puis **Partager**.

Google peut afficher un avertissement « cette adresse n'est pas un compte
Google habituel » : c'est normal, continuez.

Notez aussi, dans la barre d'adresse, l'**identifiant du fichier** — la longue
suite de caractères entre `/d/` et `/edit` :

```
https://docs.google.com/spreadsheets/d/1AbCdEf...XyZ/edit#gid=0
                                        ^^^^^^^^^^^^^^
                                        c'est ça
```

---

## Étape 3 — Installer le script « ID TRUST » dans le Sheets

Ce script donne à chaque ligne un identifiant stable. Sans lui, TRUST AI
reconnaît quand même les lignes (par empreinte), mais une ligne modifiée en
profondeur peut être vue comme nouvelle. **Avec** lui, une ligne reste la même
même si elle est déplacée, triée ou corrigée.

1. Dans le Google Sheets, ajouter une colonne dont le titre est exactement
   `ID TRUST` (à la fin du tableau, c'est parfait). Laisser les cellules vides.
2. Menu **Extensions** → **Apps Script**.
3. Effacer le contenu de `Code.gs`, puis coller **tout** le contenu du fichier
   [`google-apps-script/id-trust.gs`](../google-apps-script/id-trust.gs) de ce
   dépôt.
4. En haut du script, vérifier la liste des onglets suivis :

   ```js
   var TRUST_SHEETS = [
     { name: 'INTERNET',    headerRow: 4 },
     { name: 'SUIVIS 2025', headerRow: 4 },
   ];
   ```

   `name` est le nom **exact** de l'onglet, `headerRow` le numéro de la ligne
   des titres — **4** pour le récapitulatif de Trust Industrie, parce que
   trois lignes de bandeaux la précèdent.

   **En janvier prochain**, quand un nouvel onglet sera créé, ajoutez-le à
   cette liste. C'est la seule modification à faire.
5. Icône **Enregistrer** (disquette).
6. Choisir la fonction `remplirIdentifiantsTrust` dans la liste déroulante,
   puis **Exécuter**. Google demande une autorisation : **Autoriser**
   (« Avancé » → « Accéder à … » si l'écran d'avertissement apparaît).
   Les identifiants se remplissent.
7. **Déclencheur automatique** : icône **⏰ Déclencheurs** (colonne de gauche) →
   **Ajouter un déclencheur** :
   - Fonction : `onChangeTrustIds`
   - Source de l'événement : **Depuis la feuille de calcul**
   - Type d'événement : **En cas de modification** (*on change*)
   - **Enregistrer**.

Désormais, toute ligne ajoutée reçoit son identifiant toute seule. Un menu
**TRUST AI** apparaît aussi dans la barre du Sheets (après rechargement) pour
lancer le remplissage à la main ou vérifier les doublons.

> Le script n'envoie rien à l'extérieur et n'écrit **que** dans la colonne
> `ID TRUST`. Un copier-coller de ligne crée un doublon d'identifiant : le
> script régénère alors **uniquement la copie**, l'originale garde son
> historique.

### Pourquoi cette colonne n'est pas optionnelle

En analysant le fichier réel, on a trouvé **sept groupes de lignes strictement
identiques** — mêmes valeurs dans les 31 colonnes. Sans `ID TRUST`, TRUST AI ne
peut pas les distinguer et n'en verra qu'une seule. La colonne est ce qui donne
à chaque ligne une identité propre.

---

## Étape 4 — Les deux variables dans Vercel

1. Ouvrir <https://vercel.com/> → projet **trust-ai** → **Settings** →
   **Environment Variables**.
2. Ajouter :

   | Name | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | l'adresse `…@….iam.gserviceaccount.com` |
   | `GOOGLE_PRIVATE_KEY` | le contenu du champ `private_key` du fichier JSON |

   Pour `GOOGLE_PRIVATE_KEY` : ouvrir le fichier JSON avec un éditeur de texte,
   repérer la ligne `"private_key": "-----BEGIN PRIVATE KEY-----\n…"` et copier
   **la valeur entre guillemets**, sans les guillemets. Les `\n` peuvent être
   laissés tels quels : l'application les rétablit.

3. Cocher les environnements voulus (**Preview** pour tester, **Production**
   quand vous validez), puis **Save**.
4. Redéployer (onglet **Deployments** → dernier déploiement → **Redeploy**)
   pour que les variables soient prises en compte.

Ces deux variables n'ont **pas** le préfixe `NEXT_PUBLIC_` : elles restent sur
le serveur et ne sont jamais envoyées au navigateur.

Sans elles, l'application continue de fonctionner normalement : la page de
configuration indique simplement que la connexion Google n'est pas en place.

---

## Étape 5 — Configurer les onglets dans TRUST AI

1. Se connecter à TRUST AI avec un compte **responsable logistique**,
   **direction** ou **administrateur**.
2. Menu **Logistique** → **Configurer le récapitulatif**
   (`/logistique/recap`).
3. Cliquer **Remplir avec le format Trust Industrie**. Le formulaire se
   remplit avec la correspondance déjà établie pour votre fichier : ligne des
   titres 4, colonne `ID TRUST`, les 24 colonnes et les transporteurs. Vous
   n'avez plus qu'à ajouter l'identifiant du fichier et le nom de l'onglet.
4. Renseigner :
   - **Identifiant du Google Sheet** : la suite de caractères notée à l'étape 2 ;
   - **Nom de l'onglet** : `INTERNET` (au caractère près, tel qu'affiché en bas
     du Sheet) ;
   - **Libellé dans TRUST AI** : ce que vous voulez, c'est décoratif.
5. **Ajouter cet onglet**, puis **Prévisualiser**. La prévisualisation lit le
   fichier et affiche ce que TRUST AI comprendrait — **sans rien écrire**.
6. Quand la prévisualisation est juste : **Synchroniser maintenant**.
7. Répéter pour l'onglet de l'année précédente (`SUIVIS 2025`) si vous voulez
   aussi l'historique. **Commencez par un seul onglet** : il est plus facile de
   vérifier 332 lignes que 1 107.

Menu **Logistique** → **Lignes du récapitulatif** (`/logistique/lignes`) pour
consulter, filtrer et ouvrir le détail de chaque ligne.

### Un onglet par année

Le fichier est organisé par exercice. En janvier, quand un nouvel onglet est
créé, il suffit de l'ajouter ici (bouton **Ajouter un onglet**) et dans le
script du Sheet. Rien d'autre à faire, et aucune ligne de l'ancien onglet n'est
perdue.

Un onglet dont on ne veut plus peut être **mis en sommeil** : il n'est plus
relu, mais ses lignes et leur historique restent en place. Il n'y a aucun
bouton pour supprimer un onglet — ce serait détruire de l'historique.

### Désigner une colonne par sa LETTRE

Le champ de correspondance accepte deux choses :

- le **titre exact** de la colonne (`DATE DU RECAP`, `EXPEDITEUR`…) — les
  accents, la casse et les espaces n'ont pas d'importance ;
- la **lettre** de la colonne (`G`, `P`, `W`, `AB`…).

La lettre sert dans deux cas que votre fichier présente réellement :

- **une colonne sans titre.** Les colonnes G (les clients), P (« LIVRÉ ») et W
  (la date de retrait) n'ont pas d'en-tête ; Google affiche « Colonne 7 »,
  « Colonne 1 », « Colonne 23 », qui ne sont pas de vrais titres.
- **deux colonnes de même nom.** Votre fichier a deux colonnes
  « COMMENTAIRES » (J et N). Les deux contiennent des informations utiles —
  annulations, SAV, retours — et seule la lettre permet de les viser
  séparément.

Grâce à ça, **le fichier n'a pas besoin d'être modifié**.

### La liste des transporteurs

Le champ **Transporteurs qui livrent le client** contient, séparés par des
virgules, les noms qui apparaissent dans la colonne `EXPEDITEUR` et qui
désignent une livraison au client depuis Paris : `OMAR`, `GEODIS`, `GUISNEL`,
`DEFITRANS`, `COCOLIS`.

Cette liste est ici plutôt que dans le code parce qu'elle change : sur l'onglet
2025 il y avait `DEFITRANS` et `COCOLIS`, absents de 2026. Quand un nouveau
transporteur apparaît, ajoutez-le — pas besoin de développement.

---

## Comment TRUST AI lit le fichier

Ces règles ont été fixées avec vous après analyse du fichier réel
(1 107 lignes sur deux onglets). Elles sont vérifiées par des tests
automatiques à chaque modification du code.

### Les repères de base

- **`ORDER` est le numéro de commande FOURNISSEUR**, jamais celui du client.
- **Herblay est un magasin**, **Argenteuil un dépôt**, **Aubagne un dépôt
  doublé d'un magasin**. « Marseille » est un ancien nom d'Aubagne : les deux
  désignent le même dépôt, jamais deux endroits.
- **Argenteuil → Aubagne est un transfert**, pas deux disponibilités : la
  marchandise n'est comptée disponible **qu'une fois**, à destination.
- **Une réception partielle ne rend jamais la ligne disponible.**
- Les **lignes de total** et les lignes vides sont ignorées.
- Les dates sont comprises au format français (`05/08/2026`), au format ISO
  et au format interne de Google Sheets.
- Les cases de réception acceptent `oui`, `x`, `ok`, `✔`, `vrai`… et leurs
  contraires. Une cellule **vide** signifie « on ne sait pas » ; une cellule
  contenant seulement `-` ou `/` signifie « non ».

### Les trois façons de servir un client

Votre fichier en décrit trois, et elles sont exclusives :

| Chemin | Colonnes | Ce que ça veut dire |
|---|---|---|
| **Servi par Paris** | P + Q | Le client a été livré ou a retiré, côté Paris |
| **Livré depuis Aubagne** | T + U | Livraison au client depuis Aubagne |
| **Retiré à Aubagne** | V + W | Le client est venu chercher sur place |

**Une ligne close par l'un des trois n'est plus disponible.** C'est pour ça
qu'il faut les renseigner tous les trois : n'en suivre qu'un reviendrait à
annoncer de la marchandise déjà partie chez un client.

**C'est la date qui fait foi, pas le marqueur.** Dans votre fichier, 30 lignes
sur 142 ont une date de livraison sans le « LIVRÉ » correspondant. Se fier au
marqueur laisserait 30 clients affichés « en attente » alors qu'ils sont
servis.

Si une ligne porte **deux** sorties, TRUST AI retient la **plus ancienne** et
ouvre une anomalie pour qu'un humain vérifie.

### Comment la destination est déterminée

Dans cet ordre, on s'arrête au premier qui répond :

1. **Le bloc Aubagne est renseigné** (R, S, T, U, V ou W) → Aubagne. C'est un
   fait constaté, pas une déduction.
2. **Un numéro d'affrètement existe** → Aubagne, transfert en cours. C'est
   l'affrètement qui matérialise le trajet Argenteuil → Aubagne : 251 des 289
   lignes affrétées portent « LIVRAISON AUBAGNE », et aucune ligne confiée à un
   livreur client n'en porte.
3. **L'expéditeur nomme un dépôt** (`LIVRAISON AUBAGNE`, `RETRAIT ARGENTEUIL`)
   → ce dépôt. La faute de frappe `ARGENTEUL`, présente 219 fois, est reconnue.
4. **L'expéditeur est un livreur client connu** (liste ci-dessus) → Paris.
5. **Paris a clos la ligne** → Paris.
6. Sinon, la destination reste **indéterminée** — et c'est très bien tant que
   la marchandise n'est pas arrivée.

### Ce que TRUST AI signale

| Anomalie | Quand |
|---|---|
| **Reçue sans destination** | La marchandise est **physiquement** à Argenteuil et on ne sait pas où l'envoyer. C'est le cas le plus utile : votre fichier en compte une centaine. |
| **Annulation signalée** | Le mot « annul… » apparaît dans un commentaire. La ligne n'est **jamais fermée automatiquement** — « elle veut annuler sa commande » est une demande, pas un fait. Quand la marchandise est déjà reçue, l'anomalie est marquée **bloquante** : il y a du stock à réaffecter. |
| **Date illisible** | Une colonne de date contient autre chose qu'une date — presque toujours un décalage de colonnes. Cinq lignes de 2025 sont dans ce cas. |
| **Deux sorties enregistrées** | La ligne est close deux fois par deux chemins différents. |
| **Réception partielle** | Une partie seulement est arrivée. |
| **Ligne absente du fichier** | Une ligne déjà connue n'apparaît plus. Elle est **conservée** et signalée. |

Une commande encore chez le fournisseur, sans destination, ne déclenche
**aucune** anomalie : ce serait du bruit.

### Une ligne qui disparaît du fichier

Elle n'est **jamais supprimée**. TRUST AI la marque « absente du fichier
depuis le … » et ouvre une anomalie. Si elle réapparaît, le marquage se lève
tout seul.

### Une ligne déjà sortie ou annulée dans TRUST AI

Elle ne « recule » pas. Et une sortie déjà constatée n'est **jamais effacée**
par une relecture : si la colonne est vidée dans le fichier, la marchandise est
partie quand même.

---

## Relancer la lecture

La synchronisation se lance **à la demande**, onglet par onglet, depuis le
bouton **Synchroniser maintenant**. Elle est **idempotente** : la relancer dix
fois de suite ne crée aucun doublon, ni de ligne, ni d'événement, ni
d'anomalie.

Le bandeau de chaque onglet indique la date de dernière lecture, le nombre de
lignes lues, créées, modifiées, ignorées et les anomalies.

---

## Et si ça ne marche pas ?

| Message | Cause probable | Ce qu'il faut faire |
|---|---|---|
| « Connexion Google Sheets non configurée » | Variables absentes dans Vercel | Étape 4, puis **redéployer** |
| « Accès refusé par Google » | Le fichier n'est pas partagé avec le compte de service | Étape 2 : partager en **Lecteur** |
| « Fichier introuvable » | Identifiant du fichier erroné | Recopier la partie entre `/d/` et `/edit` |
| Aucune ligne lue | Nom d'onglet ou ligne des titres erronés | Recopier le nom **exact** de l'onglet ; ligne des titres = 4 |
| Beaucoup d'anomalies « reçue sans destination » | Normal au début : ce sont vos lignes réellement sans destination | Les traiter une par une, ou compléter la colonne `EXPEDITEUR` |
| Des lignes en double | La colonne `ID TRUST` n'existe pas ou le script n'est pas installé | Étape 3 |
| « Onglet introuvable » au lancement du script | Un nom dans `TRUST_SHEETS` ne correspond à aucun onglet | Corriger la liste en haut du script |

---

## Rappels de sécurité

- Ni l'adresse du compte de service, ni la clé privée ne sont stockées dans
  Supabase ni écrites dans les journaux.
- La clé privée ne doit **jamais** être collée dans une conversation, un
  ticket, un e-mail ou le dépôt GitHub. Si cela arrivait : Google Cloud →
  compte de service → onglet **Clés** → supprimer la clé, en créer une
  nouvelle, mettre à jour Vercel.
- L'autorisation demandée à Google est `spreadsheets.readonly` : même en cas
  de bug, TRUST AI ne **peut pas** écrire dans le fichier.
- Les tables logistiques ne sont lisibles par aucun navigateur, même
  administrateur : tout passe par des fonctions serveur qui rejouent les
  permissions et l'isolation par organisation.
