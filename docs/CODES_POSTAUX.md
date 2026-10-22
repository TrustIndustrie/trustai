# Remplir le référentiel des codes postaux

> Migration `20261022002200_codes_postaux.sql`. À faire une fois ; la table ne
> change que lorsque La Poste publie une mise à jour, soit quelques fois par an.

## Pourquoi

`customers` porte la ville et le code postal de **152 clients sur 152**. Ce qui
manque pour les placer sur une carte, ce sont les **coordonnées** : un code
postal n'est pas un point, c'est une référence qu'il faut traduire.

Sans ce référentiel, une carte serait **dessinée de mémoire**. Avec lui, elle
est **calculée**. C'est la seule différence qui compte ici.

## La source

**Base officielle des codes postaux**, publiée par **La Poste** sur
`data.gouv.fr`, sous Licence Ouverte (réutilisation libre, y compris
commerciale, avec mention de la source).

- Chercher sur https://www.data.gouv.fr : **« base officielle des codes
  postaux »**
- Format : CSV, environ **39 000 lignes**, une par couple commune / code postal
- Colonnes utiles : `code_commune_insee`, `nom_de_la_commune`,
  `code_postal`, et les coordonnées — selon la version, soit une colonne
  `_geopoint` au format `latitude,longitude`, soit deux colonnes séparées

> Le nom exact des colonnes a changé au fil des millésimes. **Ouvrez le CSV et
> regardez l'en-tête avant d'importer** : c'est trente secondes, et ça évite un
> import décalé d'une colonne.

## L'import, en trois étapes

### 1. Appliquer la migration

Collez `supabase/migrations/20261022002200_codes_postaux.sql` dans le SQL
Editor de Supabase. Elle crée la table, ses index, la politique de lecture
seule et la fonction `resolve_postal_point`.

### 2. Charger le CSV

Le plus simple, sans outil : **Supabase → Table Editor → `postal_codes` →
Insert → Import data from CSV**. L'interface demande la correspondance des
colonnes ; faites pointer :

| Colonne de la table | Colonne du CSV |
|---|---|
| `code_postal` | `code_postal` |
| `commune` | `nom_de_la_commune` |
| `code_insee` | `code_commune_insee` |
| `latitude` | la partie avant la virgule de `_geopoint` |
| `longitude` | la partie après la virgule de `_geopoint` |

Si le fichier n'a qu'une colonne `_geopoint`, découpez-la d'abord dans un
tableur (Données → Convertir → séparateur « virgule »), ou chargez le CSV tel
quel dans une table de transit puis :

```sql
insert into public.postal_codes
  (code_postal, commune, code_insee, latitude, longitude)
select
  lpad(trim(code_postal), 5, '0'),
  trim(nom_de_la_commune),
  nullif(trim(code_commune_insee), ''),
  split_part(_geopoint, ',', 1)::double precision,
  split_part(_geopoint, ',', 2)::double precision
from public.postal_codes_import
where _geopoint is not null and _geopoint <> ''
on conflict (code_postal, commune) do nothing;
```

> ⚠ **L'ordre est latitude puis longitude** dans `_geopoint`. Inversées, tous
> vos clients se retrouvent en mer au large de la Somalie — c'est l'erreur
> classique, et elle se voit immédiatement sur la carte.

### 3. Vérifier

```sql
select count(*) as lignes,
       count(distinct code_postal) as codes_distincts,
       min(latitude)::numeric(6,3) as lat_min,
       max(latitude)::numeric(6,3) as lat_max,
       min(longitude)::numeric(6,3) as lon_min,
       max(longitude)::numeric(6,3) as lon_max
from public.postal_codes;
```

Attendu pour la France entière, DOM compris : environ **39 000 lignes** et
**6 300 codes distincts**. Les bornes doivent rester plausibles — métropole
entre 41 et 51 de latitude, entre -5 et 10 de longitude ; les DOM sortent
largement de ces bornes, ce qui est normal.

Puis la couverture réelle de vos clients :

```sql
select count(*) as clients,
       count(*) filter (
         where public.resolve_postal_point(c.postal_code, c.city) is not null
       ) as clients_placables
from public.customers c;
```

Si `clients_placables` est proche de 152, la carte est complète. Sinon, les
manquants sont probablement des codes postaux mal saisis — et **c'est une
information utile sur la qualité de vos fiches clients**, pas un défaut de la
carte.

## Ce que la table ne contient pas

Aucune donnée de Trust Industrie : **aucun client, aucun chiffre, rien de
sensible**. C'est un référentiel public, et c'est pour cette raison qu'il
n'est pas cloisonné par organisation — un code postal appartient à tout le
monde. La RLS reste activée en défense en profondeur, avec une politique de
**lecture seule** et aucune écriture possible depuis le navigateur.

## Ce que la fonction refuse de faire

`resolve_postal_point` rend `NULL` pour un code inconnu. Elle **n'invente
jamais** un point « à peu près » pour faire joli : un client non plaçable doit
se voir comme non plaçable, pas apparaître au milieu d'un champ. Trois niveaux,
du plus précis au plus grossier :

1. code postal **et** commune concordants → précision `commune` ;
2. code postal seul → barycentre de ses communes, précision `code_postal` ;
3. rien de connu → `NULL`.
