# Import des exports Skara

Skara **reste l'outil officiel** : ventes, clients, factures, règlements,
comptabilité. TRUST AI en lit les exports pour disposer d'une vue interne
plus riche, et **ne lui écrit jamais rien**.

## Les quatre fichiers, et où les prendre

| Nature | Chemin dans Skara | Magasin |
|---|---|---|
| Liste des factures | Comptabilité, Gestion des factures, « Export csv » | obligatoire |
| Lignes de factures | même écran, « Export csv des lignes factures » | obligatoire |
| Catalogue des articles | Catalogue, Gestion des articles : lancer la recherche, sélectionner, exporter | sans objet |
| Journal comptable | Comptabilité, Export comptable, **bouton Historique** | multi-magasins |

### Le journal comptable ne se génère jamais depuis TRUST AI

L'écran Export comptable de Skara ne ressort que les écritures **pas encore
exportées**, et il les marque comme exportées au passage. Réexporter une
période déjà sortie renvoie un fichier vide, et lancer un export prive votre
comptable des écritures concernées.

La seule manière sûre d'alimenter TRUST AI est donc de passer par le bouton
**Historique**, qui permet de **retélécharger** le fichier d'un export
existant. Un retéléchargement ne consomme rien et peut se répéter.

Ne touchez pas au bouton « Supprimer les exports sélectionnés » : il libère
probablement les écritures pour un nouvel export, ce qui créerait un doublon
chez votre comptable si l'export était déjà importé.

### Le magasin vient du sélecteur, pas du fichier

Skara exporte le magasin choisi dans sa session, sans l'inscrire dans le
fichier. C'est vous qui le déclarez à l'import. Pour éviter l'erreur la plus
probable, à savoir importer le fichier d'un magasin sous l'étiquette d'un
autre, renseignez le **préfixe de numérotation** de chaque magasin : les
numéros commencent par deux lettres qui le désignent (FC, FL, FM observés).
L'import compare alors le fichier au magasin déclaré et **refuse** en cas de
désaccord. Tant qu'un préfixe n'est pas renseigné, l'import passe mais trace
une information.

## Ce que l'import garantit

- **Prévisualisation obligatoire.** Le bouton « Analyser sans écrire » lit le
  fichier et affiche lignes, période, préfixes, totaux et anomalies. Rien
  n'entre en base avant confirmation.
- **Un fichier ne s'importe qu'une fois.** L'empreinte de son contenu est
  unique : redéposer le même fichier ne réécrit rien et le dit.
- **Un chevauchement met à jour sans dupliquer.** Les exports se font à la
  main, donc les périodes se chevauchent forcément.
- **Un fichier incohérent est refusé.** Si le total du pied de fichier ne
  correspond pas à la somme des lignes, ou si un journal n'équilibre pas,
  l'écriture n'a pas lieu. Sur vos fichiers réels, ces totaux tombent juste
  au centime.
- **Aucun montant n'est recalculé.** Les montants arrivent en chaînes et sont
  convertis une seule fois. Le hors taxes de Skara vaut 916,667 pour 1 100
  toutes taxes : recalculer créerait des écarts inexplicables avec votre
  comptable.
- **Aucune création automatique de client ni de produit.** Les libellés Skara
  sont stockés tels quels ; le rattachement au référentiel viendra d'une
  décision humaine.
- **Pour une même période, les fichiers s'additionnent.** Un mois arrive en
  plusieurs vagues chez Skara : le dernier fichier n'est jamais la vérité à
  lui seul.

## Les pièges des données, et comment ils sont traités

**Le numéro de facture porte trois informations collées.**
`Avoir FM20260900435 (non-exportee)` donne le type, le numéro et l'état
comptable. Ils sont séparés à la lecture, sans quoi un même numéro ne se
retrouverait jamais d'un export à l'autre.

**Une pièce peut n'avoir aucun numéro.** `(non-emise)` est une pièce de
gestion, absente de la comptabilité. Elle reçoit une clé de repli
déterministe, pour que le réimport ne la duplique pas.

**Une facture entièrement annulée disparaît au profit de son avoir** dans la
liste des factures, alors que l'export des lignes la montre au positif. La
liste des factures fait donc foi pour les montants ; l'export des lignes ne
sert qu'à savoir ce qui a été vendu.

**Une ligne de facture n'est pas toujours un produit.** Remises en montant
négatif, services de livraison, éco-participation. La nature est **proposée**
par la lecture et confirmée par un humain, parce que le seul indice est un
libellé libre.

**Le coût d'achat net peut manquer alors que le brut existe.** Le coût net
est alors **reconstruit** depuis le brut et les trois remises en cascade, et
marqué comme tel. L'hypothèse retenue est que ces remises sont des
pourcentages ; elle est documentée dans le code et une remise hors de
l'intervalle 0 à 100 déclenche une anomalie.

**Skara n'émet pas les champs vides de fin de ligne.** Une ligne peut donc
compter moins de colonnes que l'en-tête, et un champ vide n'est pas un zéro.

## Se tromper de nature de fichier

Deux exports Skara commencent par la même colonne, « NUMERO FACTURE » : la
liste des factures et les lignes de factures. Seule la troisième colonne les
distingue, « LIBELLE PRODUIT » du côté des lignes.

TRUST AI lit donc l'en-tête du fichier déposé et le compare au sélecteur. En
cas d'écart, l'analyse s'arrête avec un message qui nomme la nature réelle :
il suffit de changer le sélecteur et de relancer. Rien n'est écrit.

Le journal comptable n'a pas d'en-tête : il n'est pas reconnaissable et
aucune affirmation n'est faite à son sujet.

## Consultation et contrôle

Deux écrans lisent ce qui a été importé, sans jamais rien modifier.

**Factures Skara** liste les pièces, filtrables par magasin, période, nature
et recherche sur le numéro ou le client. Trois choses y sont visibles que
Skara ne montre pas directement : la **marge creuse**, c'est-à-dire une marge
égale au hors taxes parce que le coût d'achat de l'article manque ; la
**nature de chaque ligne**, produit, remise, service ou éco-participation,
avec la mention « proposée » tant qu'un humain ne l'a pas confirmée ; et la
**contrepartie** d'une pièce, puisqu'une facture entièrement annulée n'existe
chez Skara que sous la forme de son avoir.

**Contrôle Skara** est l'écran qui donne confiance à tout le reste. Il
compare, mois par mois, ce que dit la liste des factures et ce que dit le
journal comptable. Ces deux exports étant produits séparément par Skara,
leur concordance vaut preuve.

L'écart entre les deux n'est pas une erreur : il doit s'expliquer par les
pièces **non émises**, qui sont des pièces de gestion absentes de la
comptabilité, et par les avoirs. Sur les fichiers réels, cette explication
tombe au centime. Quand l'écart ne correspond pas, c'est qu'un fichier
manque, et c'est précisément ce qu'il faut voir.

Deux indicateurs de fiabilité accompagnent chaque mois : la part de factures
**sans vendeur**, renseigné dans 3 % des cas seulement, ce qui interdit toute
analyse par vendeur tant que la saisie ne change pas ; et le nombre et le
montant hors taxes des factures à **marge creuse**.

Le même écran liste enfin les **articles sans coût d'achat exploitable**,
classés par prix de vente décroissant. C'est la liste des fiches à compléter
dans Skara pour que la marge redevienne calculable, et l'ordre est celui de
l'impact.

## Ce que ces lots ne font pas encore

L'enrichissement, c'est-à-dire le vendeur réel, le coût constaté et le
rattachement à la marchandise, arrive au lot 1C dans des tables séparées
qu'un réimport ne touchera jamais.

Le classement des articles sans coût se fait par prix de vente et non par
chiffre d'affaires généré, parce que rattacher une ligne de facture à un
article demande un rapprochement de libellés validé à la main. C'est aussi
du lot 1C.

## Retour arrière

`supabase/rollbacks/ROLLBACK_20260924001500_import_skara.sql`, à exécuter
avant les retours arrière des migrations antérieures. Les données importées
sont perdues, ce qui est sans gravité puisque Skara reste la source et que
ses fichiers sont retéléchargeables. En revanche les natures de ligne
confirmées par un humain ne sont pas reconstituables : les exporter avant.
