import type { ColumnMapping, WarehouseRef } from "./parser";
import { columnLetterToIndex } from "./parser";

/**
 * Fixtures calquées sur le VRAI fichier récapitulatif de Trust Industrie.
 *
 * Les en-têtes ci-dessous sont ceux du fichier réel, recopiés au caractère
 * près depuis l'export CSV — y compris ses particularités :
 *
 *   * la ligne de titres est la ligne 4, pas la ligne 1 ;
 *   * trois colonnes n'ont AUCUN titre (G, P, W) : Google les affiche
 *     « Colonne 7 », « Colonne 1 », « Colonne 23 ». On les atteint par leur
 *     LETTRE, sans avoir à modifier un fichier utilisé quotidiennement ;
 *   * deux colonnes s'appellent « COMMENTAIRES » (J et N), l'une avec une
 *     espace finale. Les deux portent de l'information métier : annulations,
 *     SAV, retours ;
 *   * « REÇU » porte une espace finale ;
 *   * les colonnes X à AE existent mais sont entièrement vides.
 *
 * Les noms de clients sont FICTIFS : aucune donnée personnelle réelle n'entre
 * dans le dépôt.
 */

export const FIXTURE_WAREHOUSES: WarehouseRef[] = [
  { id: "wh-argenteuil", name: "Dépôt d'Argenteuil", city: "Argenteuil" },
  { id: "wh-aubagne", name: "Dépôt d'Aubagne", city: "Aubagne" },
];

/** Transporteurs qui livrent le client depuis Paris (décision I). */
export const FIXTURE_CARRIERS = ["OMAR", "GEODIS", "GUISNEL", "DEFITRANS", "COCOLIS"];

/** En-têtes réels, dans l'ordre du fichier. La colonne AF est ajoutée par nous. */
export const FIXTURE_HEADERS = [
  /* A */ "DATE DU RECAP",
  /* B */ "NOM DU FOURNISSEUR",
  /* C */ "STATUT",
  /* D */ "REF FOURNISSEUR ARTICLES",
  /* E */ "MARCHANDISES",
  /* F */ "QUANTITE",
  /* G */ "",
  /* H */ "ORDER",
  /* I */ "ARRIVAGE PREVU",
  /* J */ "COMMENTAIRES ",
  /* K */ "REÇU ",
  /* L */ "DATE RECEPTION",
  /* M */ "AFFRETEMENT",
  /* N */ "COMMENTAIRES",
  /* O */ "EXPEDITEUR",
  /* P */ "",
  /* Q */ "DATE LIVRAISON",
  /* R */ "DATE RECEPTION DEPOT",
  /* S */ "MARCHANDISES RECU",
  /* T */ "STATUT LIVRAISON",
  /* U */ "DATE LIVRAISON AUBAGNE",
  /* V */ "STATUT SP",
  /* W */ "",
  /* X */ "", /* Y */ "", /* Z */ "", /* AA */ "", /* AB */ "",
  /* AC */ "", /* AD */ "", /* AE */ "",
  /* AF */ "ID TRUST",
];

/**
 * Correspondance réelle.
 *
 * On mélange volontairement titres et lettres : c'est exactement ce que la
 * page de configuration produira. Les titres restent lisibles quand ils
 * existent ; la lettre prend le relais pour les colonnes sans titre (G, P, W)
 * et pour départager les deux « COMMENTAIRES » (J et N).
 */
export const FIXTURE_MAPPING: ColumnMapping = {
  recap_row_id: "ID TRUST",
  recap_date: "DATE DU RECAP",
  supplier_label: "NOM DU FOURNISSEUR",
  status_label: "STATUT",
  supplier_reference: "REF FOURNISSEUR ARTICLES",
  designation: "MARCHANDISES",
  quantity: "QUANTITE",
  customer_label: "G",
  supplier_order_ref: "ORDER",
  expected_at: "ARRIVAGE PREVU",
  comments: "J",
  comments_2: "N",
  received_argenteuil: "REÇU",
  received_argenteuil_at: "DATE RECEPTION",
  freight_label: "AFFRETEMENT",
  exit_mode_label: "EXPEDITEUR",
  received_aubagne: "MARCHANDISES RECU",
  received_aubagne_at: "DATE RECEPTION DEPOT",
  paris_release_label: "P",
  paris_release_at: "DATE LIVRAISON",
  aubagne_delivery_label: "STATUT LIVRAISON",
  aubagne_delivery_at: "DATE LIVRAISON AUBAGNE",
  aubagne_pickup_label: "STATUT SP",
  aubagne_pickup_at: "W",
};

/**
 * Construit une ligne à partir de ses LETTRES de colonne.
 * Trois colonnes du fichier réel n'ayant pas de titre, la lettre est la seule
 * désignation qui marche partout.
 */
export function fixtureRow(values: Record<string, string>): string[] {
  const cells = new Array<string>(FIXTURE_HEADERS.length).fill("");
  for (const [letter, value] of Object.entries(values)) {
    const index = columnLetterToIndex(letter);
    if (index < 0 || index >= cells.length) {
      throw new Error(`Colonne inconnue dans la fixture : ${letter}`);
    }
    cells[index] = value;
  }
  return cells;
}

// --- Jeu de lignes représentatif du fichier réel ---------------------------

/** Commandée, arrivage en TEXTE LIBRE (« MI JANVIER ») : aucune date. */
export const ROW_COMMANDEE = fixtureRow({
  AF: "TR-000001",
  A: "01/01/2026",
  B: "GDM",
  C: "COMMANDÉ",
  D: "TBA13MBG",
  E: "TABLE BASSE OPHELIA PLATEAU MARBRE BLANC",
  F: "1",
  G: "Client Alpha",
  H: "25041251",
  I: "MI JANVIER",
});

/** Livrée au client par OMAR depuis Argenteuil : marqueur ET date. */
export const ROW_SORTIE_PARIS = fixtureRow({
  AF: "TR-000002",
  A: "02/01/2026",
  B: "POLEZ",
  C: "ARRIVAGE STOCK",
  E: "EVA 2 BLOCS VITO TAUPE 35 250X170",
  F: "1",
  G: "Client Bravo",
  K: "OUI",
  L: "09/01/2026",
  O: "OMAR",
  P: "LIVRÉ",
  Q: "13/01/2026",
});

/** Le marqueur « LIVRÉ » manque, la DATE fait foi (décision C). */
export const ROW_SORTIE_PARIS_SANS_MARQUEUR = fixtureRow({
  AF: "TR-000003",
  A: "03/01/2026",
  B: "ELEONORA",
  E: "CANAPÉ CONVERTIBLE CASABLANCA",
  F: "1",
  G: "Client Charlie",
  K: "OUI",
  L: "14/01/2026",
  O: "GEODIS",
  Q: "02/02/2026",
});

/** Affrètement renseigné : transfert Argenteuil → Aubagne en cours. */
export const ROW_TRANSFERT_AFFRETE = fixtureRow({
  AF: "TR-000004",
  A: "05/01/2026",
  B: "BY BOO",
  E: "FAUTEUIL HUG",
  F: "1",
  G: "Client Delta",
  K: "OUI",
  L: "20/01/2026",
  M: "E243",
  O: "LIVRAISON AUBAGNE",
});

/** Reçue à Aubagne puis LIVRÉE au client depuis Aubagne. */
export const ROW_SORTIE_LIVRAISON_AUBAGNE = fixtureRow({
  AF: "TR-000005",
  A: "06/01/2026",
  B: "SM",
  E: "TABLE REPAS AIKIN",
  F: "1",
  G: "Client Echo",
  K: "OUI",
  L: "22/01/2026",
  M: "E244",
  O: "LIVRAISON AUBAGNE",
  R: "19/05/2026",
  S: "OUI",
  T: "LIVRE",
  U: "03/04/2026",
});

/** Reçue à Aubagne puis RETIRÉE sur place par le client. */
export const ROW_SORTIE_RETRAIT_AUBAGNE = fixtureRow({
  AF: "TR-000006",
  A: "07/01/2026",
  B: "POLEZ",
  E: "MATELAS BARCELONE 90X190",
  F: "1",
  G: "Client Foxtrot",
  K: "OUI",
  O: "LIVRAISON AUBAGNE",
  S: "OUI",
  V: "RETIRE",
  W: "02/02/2026",
});

/** Annulation écrite dans le PREMIER champ de commentaires, marchandise reçue. */
export const ROW_ANNULEE_RECUE = fixtureRow({
  AF: "TR-000007",
  A: "08/01/2026",
  B: "DREAMS FLY",
  E: "LIMA BEIGE FELL ME 1 BEIGE AG",
  F: "1",
  G: "Client Golf",
  J: "ANNULER FRAUDE",
  K: "OUI",
  L: "25/01/2026",
});

/** Annulation écrite dans le SECOND champ de commentaires, rien de reçu. */
export const ROW_ANNULEE_COMMENTAIRE_2 = fixtureRow({
  AF: "TR-000008",
  A: "09/01/2026",
  F: "1",
  G: "Client Hotel",
  N: "ANNULER",
});

/** Marchandise physiquement là, aucune destination : anomalie réelle. */
export const ROW_RECUE_SANS_DESTINATION = fixtureRow({
  AF: "TR-000009",
  A: "10/01/2026",
  B: "POLEZ",
  E: "EVA 2 BLOCS VITO ECRU 23 250X170",
  F: "1",
  G: "Client India",
  K: "OUI",
  L: "28/01/2026",
});

/** Pas encore arrivée et sans destination : NORMAL, aucune anomalie. */
export const ROW_EN_AMONT = fixtureRow({
  AF: "TR-000010",
  A: "11/01/2026",
  B: "GDM",
  C: "COMMANDE SPÉCIALE",
  E: "TABLE A MANGER AXEL TRAVERTIN RONDE 1M",
  F: "1",
  G: "Client Juliett",
  I: "FIN FÉVRIER",
});

/** Deux sorties enregistrées : la plus ancienne est retenue + anomalie. */
export const ROW_DOUBLE_SORTIE = fixtureRow({
  AF: "TR-000011",
  A: "12/01/2026",
  B: "ELEONORA",
  E: "GIGOGNE DUO PILA NOIR",
  F: "1",
  G: "Client Kilo",
  K: "OUI",
  O: "LIVRAISON AUBAGNE",
  P: "LIVRÉ",
  Q: "20/03/2026",
  S: "OUI",
  T: "LIVRE",
  U: "05/03/2026",
});

/** Réception partielle : 2 sur 4 — la ligne ne devient jamais disponible. */
export const ROW_PARTIELLE = fixtureRow({
  AF: "TR-000012",
  A: "13/01/2026",
  B: "SM",
  E: "CHAISE OSLO",
  F: "4",
  G: "Client Lima",
  J: "réception partielle 2/4, reliquat annoncé",
  K: "OUI",
  L: "20/02/2026",
  O: "RETRAIT ARGENTEUIL",
});

/** Sans « ID TRUST » : identification par empreinte, destination inconnue. */
export const ROW_SANS_ID = fixtureRow({
  A: "14/01/2026",
  B: "POLEZ",
  E: "FAUTEUIL LISBONNE",
  F: "1",
  G: "Client Mike",
  O: "TRANSPORTEUR INCONNU",
  K: "OUI",
});

/**
 * Bloc Aubagne DÉCALÉ d'une colonne, tel qu'on le trouve dans le fichier réel
 * (5 lignes de l'onglet 2025) : le statut est tombé dans la colonne de date,
 * et une date sans année dans la colonne de statut.
 */
export const ROW_COLONNES_DECALEES = fixtureRow({
  AF: "TR-000013",
  A: "15/01/2026",
  B: "GDM",
  E: "TABLE BASSE JOSEPHINE TRAVERTIN",
  F: "1",
  G: "Client November",
  K: "OUI",
  U: "LIVRE",   // un statut dans la colonne « date de livraison Aubagne »
  V: "05-02",   // une date sans année dans la colonne « statut retrait »
});

/** Ligne de total : ignorée. */
export const ROW_TOTAL = fixtureRow({ E: "TOTAL", F: "13" });

/** Ligne vide : ignorée. */
export const ROW_VIDE = fixtureRow({});

export const FIXTURE_ROWS = [
  ROW_COMMANDEE,
  ROW_SORTIE_PARIS,
  ROW_SORTIE_PARIS_SANS_MARQUEUR,
  ROW_TRANSFERT_AFFRETE,
  ROW_SORTIE_LIVRAISON_AUBAGNE,
  ROW_SORTIE_RETRAIT_AUBAGNE,
  ROW_ANNULEE_RECUE,
  ROW_ANNULEE_COMMENTAIRE_2,
  ROW_RECUE_SANS_DESTINATION,
  ROW_EN_AMONT,
  ROW_DOUBLE_SORTIE,
  ROW_PARTIELLE,
  ROW_SANS_ID,
  ROW_COLONNES_DECALEES,
  ROW_TOTAL,
  ROW_VIDE,
];
