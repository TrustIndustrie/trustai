# Anomalies : détection, décision, historique

Une anomalie est un **signal à trancher par un humain**, jamais une décision
prise à sa place. Depuis la migration 13, chaque anomalie a une origine, un
parcours de résolution, et un historique inaltérable.

## Deux origines

| Origine | Qui la crée | Qui la ferme |
|---|---|---|
| **Recalculée depuis le fichier** (`synchronisation`) | la lecture du récapitulatif, à partir de ce que le parseur comprend de la ligne | la synchronisation elle-même **quand la cause a réellement disparu du fichier**, ou un humain |
| **Signalée à la main** (`manuelle`) | un responsable, depuis le détail de la ligne | un humain, uniquement |

La synchronisation ne touche **jamais** une anomalie signalée à la main.

## Ce que fait la synchronisation, à chaque lecture

Pour chaque ligne du fichier :

1. les anomalies que le parseur produit **et qui sont déjà ouvertes** restent
   ouvertes ; leur libellé suit le fichier ;
2. celles que le parseur produit **et qu'un humain a déjà tranchées sur ce
   même contenu** ne renaissent pas. Le contenu est reconnu par une empreinte
   de la ligne source prise au moment de la décision. Si la ligne change
   (nouveau commentaire, nouvelle date…), la décision ne couvre plus et
   l'anomalie est recréée : c'est voulu, l'humain a décidé sur un autre état ;
3. celles que le parseur **ne produit plus** sont fermées automatiquement,
   résolution `disparue`, avec une trace qui pointe la lecture responsable ;
4. une ligne **absente** du fichier reçoit `ligne_absente_du_fichier` ; quand
   elle **revient**, cette anomalie se ferme d'elle-même.

## Le parcours humain

Dans **Logistique → Lignes du récapitulatif**, le détail d'une ligne liste ses
anomalies, ouvertes d'abord. Un rôle qui détient `valider_decision`
(responsable logistique, direction, administrateur) peut :

- **Traitée** : le problème est réglé ou pris en charge ;
- **Ignorer** : le signal est connu et n'appelle pas d'action ;
- **Rouvrir** une anomalie résolue, humaine ou automatique ;
- **Signaler** une anomalie manuelle sur la ligne, avec sa gravité.

Chaque action exige un **motif** (3 caractères minimum). Le rôle `logistique`
consulte tout mais ne tranche rien ; la règle est rejouée côté serveur.

## Pourquoi une anomalie bloquante compte

Depuis la migration 12, une anomalie **bloquante** ouverte interdit
d'affecter la ligne à un dossier de livraison. Trancher l'anomalie est donc
le geste qui rend la marchandise affectable. Avant la migration 13, rien ne
permettait de le faire.

## Historique

Chaque décision, humaine ou automatique, est une ligne dans
`logistics_anomaly_decisions` : action, résolution, motif, auteur (vide pour
la synchronisation, qui indique alors la lecture), date, état précédent.
La table est en **ajout seul** : on ne modifie pas une décision, on en prend
une nouvelle. Le détail de la ligne affiche cet historique sous chaque
anomalie.

## Où c'est vérifié

- `supabase/tests/phase5_anomalies.test.sql` : fermeture automatique tracée,
  anomalie manuelle préservée, décision respectée à contenu égal et anomalie
  recréée si le contenu change, permissions et isolation, réouverture,
  historique inaltérable, interaction avec la migration 12, ligne absente
  revenue, aucune lecture directe.
