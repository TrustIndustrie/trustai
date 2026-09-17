import { describe, expect, it } from "vitest";
import {
  columnLetterToIndex,
  detectCancellation,
  findColumnIndex,
  indexToLetter,
  isTotalRow,
  normalizeHeader,
  parseBoolean,
  parseDate,
  parseQuantity,
  parseRecapRows,
  resolveWarehouse,
  type ParsedRow,
} from "./parser";
import {
  FIXTURE_CARRIERS,
  FIXTURE_HEADERS,
  FIXTURE_MAPPING,
  FIXTURE_ROWS,
  FIXTURE_WAREHOUSES,
  ROW_ANNULEE_COMMENTAIRE_2,
  ROW_ANNULEE_RECUE,
  ROW_COLONNES_DECALEES,
  ROW_COMMANDEE,
  ROW_DOUBLE_SORTIE,
  ROW_EN_AMONT,
  ROW_PARTIELLE,
  ROW_RECUE_SANS_DESTINATION,
  ROW_SANS_ID,
  ROW_SORTIE_LIVRAISON_AUBAGNE,
  ROW_SORTIE_PARIS,
  ROW_SORTIE_PARIS_SANS_MARQUEUR,
  ROW_SORTIE_RETRAIT_AUBAGNE,
  ROW_TRANSFERT_AFFRETE,
  fixtureRow,
} from "./fixtures";

const ARGENTEUIL = "wh-argenteuil";
const AUBAGNE = "wh-aubagne";

function parseOne(row: string[]): ParsedRow {
  return parseRecapRows([row], {
    headers: FIXTURE_HEADERS,
    mapping: FIXTURE_MAPPING,
    warehouses: FIXTURE_WAREHOUSES,
    firstDataRow: 5,
    clientCarriers: FIXTURE_CARRIERS,
  })[0];
}

const anomalyTypes = (row: ParsedRow) => row.anomalies.map((a) => a.type);

// ---------------------------------------------------------------------------
describe("Normalisation des en-têtes", () => {
  it("ignore accents, casse et ponctuation", () => {
    expect(normalizeHeader("DÉSIGNATION")).toBe("designation");
    expect(normalizeHeader("  Réf. Fournisseur  ")).toBe("ref fournisseur");
    expect(normalizeHeader("QTÉ")).toBe("qte");
  });

  it("retrouve une colonne par son titre, quel que soit l'ordre", () => {
    expect(findColumnIndex(FIXTURE_HEADERS, "ORDER")).toBe(7);
    expect(findColumnIndex(FIXTURE_HEADERS, "reçu")).toBe(10);
    expect(findColumnIndex(FIXTURE_HEADERS, "Inconnue")).toBe(-1);
  });
});

describe("Désignation d'une colonne par sa LETTRE (décision G)", () => {
  it("convertit les lettres en index", () => {
    expect(columnLetterToIndex("A")).toBe(0);
    expect(columnLetterToIndex("G")).toBe(6);
    expect(columnLetterToIndex("Z")).toBe(25);
    expect(columnLetterToIndex("AA")).toBe(26);
    expect(columnLetterToIndex("AF")).toBe(31);
    expect(columnLetterToIndex("pas une lettre")).toBe(-1);
  });

  it("fait l'aller-retour index ↔ lettre", () => {
    for (const i of [0, 6, 25, 26, 31, 701]) {
      expect(columnLetterToIndex(indexToLetter(i))).toBe(i);
    }
  });

  it("atteint une colonne SANS titre", () => {
    // G, P et W n'ont aucun titre dans le fichier réel.
    expect(findColumnIndex(FIXTURE_HEADERS, "G")).toBe(6);
    expect(findColumnIndex(FIXTURE_HEADERS, "P")).toBe(15);
    expect(findColumnIndex(FIXTURE_HEADERS, "W")).toBe(22);
  });

  it("départage deux colonnes de même titre", () => {
    // « COMMENTAIRES » existe en J et en N : seule la lettre les distingue.
    expect(findColumnIndex(FIXTURE_HEADERS, "J")).toBe(9);
    expect(findColumnIndex(FIXTURE_HEADERS, "N")).toBe(13);
    // Par le titre, on ne peut atteindre que la première.
    expect(findColumnIndex(FIXTURE_HEADERS, "COMMENTAIRES")).toBe(9);
  });

  it("le TITRE l'emporte sur la lettre", () => {
    // Une colonne réellement intitulée « M » reste atteignable par son nom.
    const headers = ["A", "M", "AUTRE"];
    expect(findColumnIndex(headers, "M")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Lecture des valeurs", () => {
  it("interprète les cases cochées", () => {
    expect(parseBoolean("X")).toBe(true);
    expect(parseBoolean("oui")).toBe(true);
    expect(parseBoolean("Reçu")).toBe(true);
    expect(parseBoolean("NON")).toBe(false);
    expect(parseBoolean("-")).toBe(false);
    // Une cellule vide n'est pas un « non » : on ne sait pas.
    expect(parseBoolean("")).toBeUndefined();
    expect(parseBoolean(undefined)).toBeUndefined();
    expect(parseBoolean("peut-être")).toBeUndefined();
  });

  it("lit les dates françaises, ISO et les numéros de série", () => {
    expect(parseDate("05/08/2026")).toBe("2026-08-05");
    expect(parseDate("5-8-26")).toBe("2026-08-05");
    expect(parseDate("2026-08-05")).toBe("2026-08-05");
    expect(parseDate("44835")).toBe("2022-10-01");
    expect(parseDate("32/13/2026")).toBeUndefined();
  });

  it("laisse vide un arrivage écrit en toutes lettres", () => {
    // Le fichier réel contient « MI JANVIER », « LUNDI PROCHAIN »…
    expect(parseDate("MI JANVIER")).toBeUndefined();
    expect(parseDate("LUNDI PROCHAIN")).toBeUndefined();
    expect(parseDate("FIN FÉVRIER")).toBeUndefined();
  });

  it("lit les quantités", () => {
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity("x3")).toBe(3);
    expect(parseQuantity("2,0")).toBe(2);
    expect(parseQuantity("")).toBeUndefined();
    expect(parseQuantity("plusieurs")).toBeUndefined();
  });

  it("écarte les lignes de total", () => {
    expect(isTotalRow(["TOTAL", "13"])).toBe(true);
    expect(isTotalRow(["Canapé", "1", "Client"])).toBe(false);
  });
});

describe("Dépôts", () => {
  it("Marseille est un alias d'Aubagne, jamais un lieu distinct", () => {
    expect(resolveWarehouse(FIXTURE_WAREHOUSES, "Marseille")?.id).toBe(AUBAGNE);
    expect(resolveWarehouse(FIXTURE_WAREHOUSES, "LIVRAISON AUBAGNE")?.id).toBe(AUBAGNE);
  });

  it("tolère la faute de frappe « ARGENTEUL » du fichier réel", () => {
    expect(resolveWarehouse(FIXTURE_WAREHOUSES, "LIVRAISON ARGENTEUL")?.id).toBe(ARGENTEUIL);
    expect(resolveWarehouse(FIXTURE_WAREHOUSES, "RETRAIT ARGENTEUIL")?.id).toBe(ARGENTEUIL);
  });

  it("ne devine pas un lieu inconnu", () => {
    expect(resolveWarehouse(FIXTURE_WAREHOUSES, "Entrepôt Nord")).toBeUndefined();
    expect(resolveWarehouse(FIXTURE_WAREHOUSES, "OMAR")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("Les trois chemins de sortie (décision A)", () => {
  it("Paris : marqueur et date", () => {
    const row = parseOne(ROW_SORTIE_PARIS);
    expect(row.stage).toBe("sortie");
    expect(row.exit_channel).toBe("paris");
    expect(row.exit_at).toBe("2026-01-13");
    expect(row.destination_warehouse_id).toBe(ARGENTEUIL);
  });

  it("la DATE suffit, même sans le marqueur « LIVRÉ » (décision C)", () => {
    const row = parseOne(ROW_SORTIE_PARIS_SANS_MARQUEUR);
    expect(row.stage).toBe("sortie");
    expect(row.exit_channel).toBe("paris");
    expect(row.exit_at).toBe("2026-02-02");
  });

  it("livraison depuis Aubagne", () => {
    const row = parseOne(ROW_SORTIE_LIVRAISON_AUBAGNE);
    expect(row.stage).toBe("sortie");
    expect(row.exit_channel).toBe("livraison_aubagne");
    expect(row.exit_at).toBe("2026-04-03");
    expect(row.destination_warehouse_id).toBe(AUBAGNE);
  });

  it("retrait sur place à Aubagne", () => {
    const row = parseOne(ROW_SORTIE_RETRAIT_AUBAGNE);
    expect(row.stage).toBe("sortie");
    expect(row.exit_channel).toBe("retrait_aubagne");
    expect(row.exit_at).toBe("2026-02-02");
  });

  it("une ligne sortie n'est JAMAIS annoncée disponible", () => {
    for (const fixture of [
      ROW_SORTIE_PARIS,
      ROW_SORTIE_PARIS_SANS_MARQUEUR,
      ROW_SORTIE_LIVRAISON_AUBAGNE,
      ROW_SORTIE_RETRAIT_AUBAGNE,
    ]) {
      expect(parseOne(fixture).stage).not.toBe("disponible");
    }
  });

  it("deux sorties : la plus ancienne fait foi + anomalie (décision J)", () => {
    const row = parseOne(ROW_DOUBLE_SORTIE);
    expect(row.exit_channel).toBe("livraison_aubagne");   // 05/03 avant 20/03
    expect(row.exit_at).toBe("2026-03-05");
    expect(anomalyTypes(row)).toContain("sorties_multiples");
  });
});

// ---------------------------------------------------------------------------
describe("Destination (décision B)", () => {
  it("1. le bloc Aubagne renseigné est un FAIT", () => {
    const row = parseOne(ROW_SORTIE_LIVRAISON_AUBAGNE);
    expect(row.destination_warehouse_id).toBe(AUBAGNE);
    expect(row.destination_confidence).toBe("sure");
  });

  it("2. un numéro d'affrètement vaut transfert vers Aubagne", () => {
    const row = parseOne(ROW_TRANSFERT_AFFRETE);
    expect(row.destination_warehouse_id).toBe(AUBAGNE);
    expect(row.stage).toBe("en_transfert");
    expect(row.freight_ref).toBe("E243");
    expect(row.events.some((e) => e.event_type === "depart_transfert")).toBe(true);
  });

  it("3. l'expéditeur qui nomme un dépôt fait foi", () => {
    const row = parseOne(
      fixtureRow({ A: "01/02/2026", E: "Article", F: "1", G: "Client", O: "RETRAIT ARGENTEUIL" }),
    );
    expect(row.destination_warehouse_id).toBe(ARGENTEUIL);
    expect(row.destination_confidence).toBe("sure");
  });

  it("4. un livreur client connu renvoie vers Paris", () => {
    const row = parseOne(
      fixtureRow({ A: "01/02/2026", E: "Article", F: "1", G: "Client", O: "GEODIS" }),
    );
    expect(row.destination_warehouse_id).toBe(ARGENTEUIL);
    expect(row.destination_confidence).toBe("deduite");
  });

  it("la liste des livreurs n'est PAS figée : sans elle, rien n'est deviné", () => {
    const sansListe = parseRecapRows(
      [fixtureRow({ A: "01/02/2026", E: "Article", F: "1", G: "Client", O: "GEODIS" })],
      {
        headers: FIXTURE_HEADERS,
        mapping: FIXTURE_MAPPING,
        warehouses: FIXTURE_WAREHOUSES,
        clientCarriers: [],
      },
    )[0];
    expect(sansListe.destination_warehouse_id).toBeUndefined();
    expect(sansListe.destination_confidence).toBe("ambigue");
  });

  it("5. une sortie Paris implique une destination Paris", () => {
    expect(parseOne(ROW_SORTIE_PARIS_SANS_MARQUEUR).destination_warehouse_id).toBe(ARGENTEUIL);
  });

  it("Argenteuil → Aubagne compte UNE seule disponibilité, à destination", () => {
    const transfert = parseOne(ROW_TRANSFERT_AFFRETE);
    expect(transfert.stage).toBe("en_transfert");
    expect(transfert.current_warehouse_id).toBe(ARGENTEUIL);
    expect(transfert.stage).not.toBe("disponible");
  });
});

// ---------------------------------------------------------------------------
describe("Anomalies : signaler sans deviner", () => {
  it("marchandise reçue sans destination → anomalie (décision K)", () => {
    const row = parseOne(ROW_RECUE_SANS_DESTINATION);
    expect(anomalyTypes(row)).toContain("recue_sans_destination");
    expect(row.destination_warehouse_id).toBeUndefined();
  });

  it("expéditeur inconnu ET marchandise reçue : le libellé est cité", () => {
    const row = parseOne(ROW_SANS_ID);
    const anomaly = row.anomalies.find((a) => a.type === "recue_sans_destination");
    expect(anomaly?.message).toContain("TRANSPORTEUR INCONNU");
  });

  it("commande encore en amont : AUCUNE anomalie de destination", () => {
    const row = parseOne(ROW_EN_AMONT);
    expect(anomalyTypes(row)).not.toContain("recue_sans_destination");
    expect(row.destination_confidence).toBe("ambigue");
    expect(row.stage).toBe("commandee");
  });

  it("annulation dans le 1er champ de commentaires, marchandise reçue → bloquant", () => {
    const row = parseOne(ROW_ANNULEE_RECUE);
    const anomaly = row.anomalies.find((a) => a.type === "annulation_signalee");
    expect(anomaly).toBeDefined();
    expect(anomaly?.severity).toBe("bloquant");
    // Décision F : jamais de fermeture automatique.
    expect(row.stage).not.toBe("annulee");
    expect(row.stage).not.toBe("sortie");
  });

  it("annulation dans le 2nd champ de commentaires (décision E)", () => {
    const row = parseOne(ROW_ANNULEE_COMMENTAIRE_2);
    const anomaly = row.anomalies.find((a) => a.type === "annulation_signalee");
    expect(anomaly).toBeDefined();
    expect(anomaly?.severity).toBe("avertissement");
  });

  it("repère les formulations réelles du fichier", () => {
    expect(detectCancellation("ANNULER FRAUDE")).toBe("ANNULER FRAUDE");
    expect(detectCancellation("commande annulée")).toBe("commande annulée");
    expect(detectCancellation("ELLE VEUX ANNULER SA COMMANDE")).toBeDefined();
    expect(detectCancellation(undefined, "annuler")).toBe("annuler");
    expect(detectCancellation("REMBOURSEMENT")).toBeUndefined();
    expect(detectCancellation()).toBeUndefined();
  });

  it("les deux champs de commentaires sont conservés", () => {
    const row = parseOne(
      fixtureRow({ A: "01/02/2026", E: "Article", F: "1", G: "Client", J: "premier", N: "second" }),
    );
    expect(row.comments).toBe("premier — second");
  });

  it("colonnes décalées : une date illisible est signalée, pas ignorée", () => {
    const row = parseOne(ROW_COLONNES_DECALEES);
    const anomaly = row.anomalies.find((a) => a.type === "date_illisible");
    expect(anomaly).toBeDefined();
    expect(anomaly?.message).toContain("LIVRE");
    // Sans cette alerte, « LIVRE » tombé dans une colonne de date serait
    // perdu en silence et la sortie ne serait jamais vue.
  });

  it("« ARRIVAGE PREVU » en texte libre n'est JAMAIS signalé", () => {
    // Cette colonne contient du texte par nature : ce serait du bruit.
    const row = parseOne(ROW_EN_AMONT);
    expect(anomalyTypes(row)).not.toContain("date_illisible");
    expect(row.expected_at).toBeUndefined();
  });

  it("réception partielle : jamais disponible", () => {
    const row = parseOne(ROW_PARTIELLE);
    expect(row.stage).toBe("recue_argenteuil");
    expect(row.stage).not.toBe("disponible");
    expect(anomalyTypes(row)).toContain("reception_partielle");
  });
});

// ---------------------------------------------------------------------------
describe("Identification des lignes", () => {
  it("« ID TRUST » est repris tel quel", () => {
    expect(parseOne(ROW_SORTIE_PARIS).recap_row_id).toBe("TR-000002");
  });

  it("sans « ID TRUST », une empreinte stable est calculée", () => {
    const row = parseOne(ROW_SANS_ID);
    expect(row.recap_row_id).toBeUndefined();
    expect(row.fingerprint).toHaveLength(32);
    expect(parseOne(ROW_SANS_ID).fingerprint).toBe(row.fingerprint);
  });

  it("deux lignes STRICTEMENT identiques ont la même empreinte", () => {
    // Le cas existe vraiment dans le fichier (7 groupes sur les deux onglets) :
    // sans « ID TRUST », elles sont indiscernables. C'est la raison d'être
    // du script installé dans le Google Sheets.
    const a = parseOne(ROW_SANS_ID);
    const b = parseOne([...ROW_SANS_ID]);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("Règles métier héritées", () => {
  it("« ORDER » est le numéro de commande FOURNISSEUR", () => {
    const row = parseOne(ROW_COMMANDEE);
    expect(row.supplier_order_ref).toBe("25041251");
    expect(row.customer_label).toBe("Client Alpha");
  });

  it("la ligne source brute est conservée, colonnes sans titre comprises", () => {
    const row = parseOne(ROW_SORTIE_PARIS);
    expect(row.raw_row["G"]).toBe("Client Bravo");   // colonne sans titre
    expect(row.raw_row["P"]).toBe("LIVRÉ");          // colonne sans titre
    expect(row.raw_row["EXPEDITEUR"]).toBe("OMAR");
  });
});

// ---------------------------------------------------------------------------
describe("Lecture complète du jeu de fixtures", () => {
  const rows = parseRecapRows(FIXTURE_ROWS, {
    headers: FIXTURE_HEADERS,
    mapping: FIXTURE_MAPPING,
    warehouses: FIXTURE_WAREHOUSES,
    firstDataRow: 5,
    clientCarriers: FIXTURE_CARRIERS,
  });

  it("écarte les lignes vides et de total, garde le reste", () => {
    expect(rows).toHaveLength(FIXTURE_ROWS.length);
    expect(rows.filter((r) => r.ignored)).toHaveLength(2);
    expect(rows.filter((r) => !r.ignored)).toHaveLength(14);
  });

  it("numérote les lignes à partir de la première ligne de données", () => {
    expect(rows[0].rowNumber).toBe(5);
    expect(rows[1].rowNumber).toBe(6);
  });

  it("compte les sorties, tous chemins confondus", () => {
    const sorties = rows.filter((r) => !r.ignored && r.stage === "sortie");
    // 3 chemins + la ligne à double sortie + la ligne aux colonnes décalées.
    // Cette dernière EST close : « LIVRE » et une date sont bien là, même mal
    // rangés. La laisser ouverte annoncerait une marchandise déjà partie —
    // l'anomalie « date illisible » avertit qu'il faut vérifier.
    expect(sorties).toHaveLength(6);
    expect(new Set(sorties.map((r) => r.exit_channel))).toEqual(
      new Set(["paris", "livraison_aubagne", "retrait_aubagne"]),
    );
  });

  it("aucune ligne annulée n'est fermée d'office", () => {
    const annulees = rows.filter((r) =>
      r.anomalies.some((a) => a.type === "annulation_signalee"),
    );
    expect(annulees).toHaveLength(2);
    for (const row of annulees) expect(row.stage).not.toBe("sortie");
  });
});
