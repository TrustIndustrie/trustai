# TRUST AI — la mission réelle

> Document de référence, écrit le 21 octobre 2026 après que Farouk a rappelé
> pourquoi TRUST AI a été commandé. Il n'existait nulle part, et le projet
> avançait sans lui. À tenir à jour : c'est lui qui arbitre les priorités.

---

## 1. Ce que le patron a demandé

**Remplacer le responsable logistique.** Pas l'assister, pas lui faire un
tableau de bord : faire son travail à sa place.

Concrètement, de la commande jusqu'à la porte du client :

1. **Recevoir la commande** — le « check du matin ».
2. **Affréter** — composer les semis qui partent d'Argenteuil vers le dépôt
   du Sud, décider quand ils partent, leur attribuer un numéro.
3. **Créer et piloter les tournées** — regrouper les clients servis par un
   camion et deux livreurs, par secteur (Marseille, par exemple).

Tout le reste du projet — Shopify, Skara, le récapitulatif, les
encaissements — est au service de cette chaîne ou périphérique à elle.

---

## 2. Le constat au 21 octobre 2026 : TRUST AI **recopie**, il ne décide pas

C'est le point dur, et il faut le regarder en face.

La fonction `sync_recap_rows` écrit littéralement :

```sql
stage = case when stage in ('sortie','annulee') then stage else v_stage end,
freight_ref = coalesce(v_freight, freight_ref),
```

où `v_stage` et `v_freight` viennent **du Google Sheet**. Autrement dit :

- **aucune fonction de TRUST AI ne décide de l'étape d'une ligne** ;
- **aucune ne compose un affrètement ni n'attribue un numéro de semi** — les
  41 lignes `en_transfert` portent toutes un `freight_ref`, mais c'est un
  numéro qu'un humain a déjà écrit dans le récapitulatif ;
- **aucune ne crée de dossier de livraison** : `insert into
  public.delivery_jobs` n'apparaît que dans six jeux d'essai.

TRUST AI est aujourd'hui **un miroir fidèle et cloisonné du travail du
responsable logistique, avec détection d'anomalies**. Ce socle est solide et
nécessaire. Mais entre *voir* et *faire*, il manque tout le métier.

---

## 3. État des données (mesuré sur `trust-ai-dev`, 21 octobre 2026)

| Table | Lignes | Lecture |
|---|---|---|
| `logistics_lines` | **364** | la matière existe |
| → `a_commander` / `commandee` | 15 / 35 | pas encore chez nous |
| → `en_transfert` | 41 | affrètement en cours, `freight_ref` renseigné à 100 % |
| → `disponible` | **59** | **la matière première des tournées** |
| → `sortie` | 214 | déjà parti chez le client (59 % du total) |
| → `attendue`, `recue_argenteuil`, `recue_aubagne` | **0** | la réception n'est jamais tracée |
| `delivery_jobs` | **0** | ⛔ rien n'en crée |
| `delivery_slots` | **0** | ⛔ |
| `delivery_rounds` | **0** | ⛔ |
| `delivery_round_stops` | **0** | ⛔ |
| `customers` | 152 — dont **152 avec ville et code postal** | ✅ géolocalisables |
| `suppliers` | 14 — dont 14 avec pays | pas d'adresse, pas de ville |
| `warehouses` | 2 | Argenteuil et le dépôt du Sud |

**Les lots 2A, 2B et 2C ont construit des mécanismes corrects, testés et
migrés — que rien n'alimente.** Créneaux, tournées, droits du livreur : du
code mort tant que l'entrée de la chaîne n'existe pas.

### Deux limites de données à connaître

- **Le lien caisse → client n'est pas fiable.** `logistics_lines` ne porte
  qu'un `customer_label` en **texte libre**, sans clé étrangère vers
  `customers`. On peut afficher où sont les clients ; on ne peut pas encore
  affirmer quelle caisse va chez lequel.
- **Les clients sont probablement dupliqués.** 152 clients pour 154
  commandes Shopify, et `create_store_order` insère un client à chaque
  commande sans dédoublonnage. Le seul index unique porte sur
  `shopify_customer_id`.

---

## 4. Les trois métiers, et ce qui manque pour chacun

| Métier | Ce qui existe | Ce qui manque |
|---|---|---|
| **1. Recevoir la commande** | les lignes arrivent du récapitulatif Google Sheets, en lecture seule | **on ignore par quel canal la commande parvient au responsable logistique** — question ouverte, réponses attendues le 22 octobre |
| **2. Affréter** | `freight_ref`, l'étape `en_transfert`, la route Argenteuil → Sud | **rien ne décide** : pas de regroupement en semi, pas de seuil de remplissage, pas de date de départ, pas d'attribution de numéro |
| **3. Tournées** | `delivery_rounds`, `delivery_round_stops`, `delivery_slots`, `app.delivery_round_scope()`, rôle `livreur` (migration 20) | **0 ligne partout** · aucun déclencheur · lien client non fiable · aucune géolocalisation |

---

## 5. Les huit questions à rapporter

La réponse « par mail » ou « par Skara » ne suffira pas : chaque point
ci-dessous change la conception.

1. **Par quel canal exactement la commande arrive-t-elle ?** Mail, Skara,
   WhatsApp, appel du magasin, le Google Sheet lui-même ?
2. **Qui la lui envoie ?** Le vendeur, le magasin, Shopify, le client ?
3. **Que regarde-t-il chaque matin ?** Quel écran, quel onglet, quelle boîte
   mail ? Qu'est-ce qui lui dit « ça, c'est nouveau » ?
4. **Comment sait-il qu'une marchandise est prête à partir ?** C'est le cœur :
   c'est ce qui crée le dossier de livraison.
5. **Comment décide-t-il de déclencher un semi ?** Au remplissage, à date
   fixe, à l'urgence client ?
6. **Comment compose-t-il une tournée ?** Par secteur, par date promise, par
   volume ? Combien de passages par jour, quel rayon ?
7. **Que fait-il quand ça rate ?** Client absent, marchandise manquante : qui
   prévient, comment, dans quel délai ?
8. **Qu'est-ce qu'il fait dans Skara, et qu'est-ce qu'il fait ailleurs ?**

> Si on peut l'observer une matinée, ça vaudra dix réunions.

---

## 6. La décision bloquante : la frontière Skara / TRUST AI

Skara gère **déjà** un onglet `Clients › Gestion des livraisons` : code de
livraison, date prévue, date de livraison, client, code postal-ville, sortie
effectuée, type BL/BS, référence, restant dû. Plus un `Planning de
livraison`, une `Diffusion` SMS et une impression de feuille de route.

**Tant que personne n'a tranché qui est maître de la livraison, construire
l'entrée de la chaîne dans TRUST AI revient à risquer de dupliquer un outil
que les équipes utilisent déjà.** C'est la décision la plus structurante du
projet, et elle appartient à la direction.

Deux lectures possibles, à arbitrer :

- **Skara reste maître de la livraison**, et TRUST AI lui fournit la
  disponibilité réelle de la marchandise (ce qu'il sait déjà faire).
- **TRUST AI prend la livraison**, et Skara redevient l'outil commercial et
  comptable. Les lots 2A/2B/2C prennent alors tout leur sens.

---

## 7. Le dépôt du Sud n'est pas à Aubagne

Il est à **La Penne-sur-Huveaune** (13821), sur un **site partagé avec le
dépôt de Mobilier Malin** — ce partage contraint les quais, l'espace et les
créneaux, et personne ne le devinerait.

- **Le magasin** Trust Aubagne, lui, est bien à Aubagne : ne pas confondre.
- La base le nomme encore `Dépôt d'Aubagne`. Correction à appliquer :

```sql
update public.warehouses
set city  = 'La Penne-sur-Huveaune',
    name  = 'Dépôt de La Penne-sur-Huveaune',
    notes = 'Site partagé avec le dépôt de Mobilier Malin.'
where city = 'Aubagne';
```

- Les libellés de l'application et du laboratoire 3D sont déjà corrigés, et
  le rapprochement par nom reconnaît **les deux appellations** : renommer
  l'entrepôt ne fera donc pas basculer la marchandise du Sud à Argenteuil.
- La valeur d'étape reste `recue_aubagne` en base — seul l'affichage change.

---

## 8. Le laboratoire 3D — en attente de matière

Branche `experimental/vue-3d`, visible en prévisualisation Vercel. Deux
sources : fictive, et réelle en **lecture seule** (`list_logistics_lines`
uniquement, fonction `stable` qui ne peut rien écrire).

Demandes d'évolution formulées le 21 octobre, et leur faisabilité :

| Demande | Faisable ? | Effort | Bloqué par |
|---|---|---|---|
| Écarter les dépôts (échelle rompue, « ~770 km · 8 h ») | ✅ | 1-2 h | rien |
| Les 14 fournisseurs par pays, flux « il livre » / « on retire » | ✅ | ~1 j | rien (adresse absente → placement par pays seulement) |
| Les 152 villes clientes | ✅ | 2-3 j | table de correspondance code postal → coordonnées (donnée publique, hors ligne) |
| Suivre le camion par ses passages | ✅ techniquement | 2-3 j | **0 tournée, 0 passage** |
| Suivre le camion par GPS | ⛔ | semaines | aucune géolocalisation · décision RGPD et dialogue social |
| Les tournées desservies | ✅ techniquement | 3-4 j | **0 tournée** |

**Le retournement à retenir :** ce que la 3D devait montrer — les camions en
route, les tournées desservies — c'est exactement le métier qui n'existe pas
encore. La 3D ne manque pas de fonctionnalités, elle manque de matière.

---

## 9. Règles permanentes du projet

- TRUST AI **n'écrit jamais** dans le Google Sheet original.
- Toute action extérieure ou financière sensible reste **soumise à validation
  humaine**.
- Skara reste l'outil commercial officiel.
- Le Google Sheet reste l'outil officiel de disponibilité.
- Le laboratoire 3D ne va pas en production et n'écrit nulle part.
