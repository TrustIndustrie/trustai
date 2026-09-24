import { describe, expect, it } from "vitest";
import {
  computeNetCost,
  isBlocked,
  parseArticles,
  parseInvoiceList,
  parseInvoiceLines,
  parseInvoiceNumberField,
  parseJournal,
  proposeLineNature,
} from "./parsers";

/**
 * Les jeux d'essai reproduisent la structure EXACTE des exports Skara
 * observés, y compris leurs pièges : champ numéro composite, pièce non
 * émise, champs vides de fin non émis, remises en lignes négatives, pied de
 * fichier sur deux lignes. Les noms de clients sont fictifs : aucune donnée
 * personnelle réelle n'entre dans le dépôt.
 */

const crlf = (lines: string[]) => lines.join("\r\n") + "\r\n";

const LISTE_FACTURES = crlf([
  "NUMERO FACTURE;DATE;CLIENT;VENDEUR;TOTAL TTC;TOTAL HT;TVA;MARGE;RESTE A REGLER;ECO TTC;SERVICE TTC",
  "Avoir FL20260900211 (non-exportee);02-09-2026;Client A;;-1378;-1148.333;-229.667;-715.443;;-2.64;170",
  "FL20260900218 (non-exportee);02-09-2026;Client B;;449.00;374.166;74.834;171.166;0;0.00;-50.00",
  "FL20260900220 (non-exportee);06-09-2026;Client C;;2350.00;1958.333;391.667;1958.333;0;14.10;-423.00",
  "(non-emise);18-09-2026;Client D;;-150;-125;-25;120;0;-0;0",
  // Dernier champ non émis, comme dans vos fichiers réels.
  "FL20260900234 (non-exportee);19-09-2026;Client E;;1698.00;1415.000;283;800;0;7.50",
  "TOTAUX;;;;2969;2474.166;494.834;2334.056;0;18.96;-303",
]);

const LIGNES_FACTURES = crlf([
  "NUMERO FACTURE;DATE;LIBELLE PRODUIT;QUANTITE;POIDS UNITAIRE;POIDS TOTAL;VOLUME;VOLUME TOTAL;PRIX TOTAL",
  "FM20260900435;01-09-2026;Canapé panoramique VANESSA  Beige Dimension : L. 365 x M. 200 ;1;0;0;0;0;2099.00",
  "FM20260900435;01-09-2026;Pouf Vanessa U 120x90 cm  POUF ANNULE;1;0;0;0;0;399.00",
  "FM20260900435;01-09-2026;Promo     ;1;0;0;0;0;-98.00",
  "FM20260900435;01-09-2026;LIVRAISON + INSTALLATION OFFERTE SUD     ATTENTION PAS DE CAMION;1;0;0;0;0;80.00",
  "FM20260900479;01-09-2026;Canapé convertible CASABLANCA  BEIGE ;1;0;0;0;0;949.00",
  "FM20260900479;01-09-2026;Remise 1    CANAPE ;1;0;0;0;0;-150.00",
  ";;;;;Poids Total;;volume Total;Prix Total",
  ";;;;;0;;0;3279;",
]);

const CATALOGUE_ENTETE =
  '"pk_fournisseur","libelle_fournisseur","pk_collection","libelle_collection",' +
  '"reference_fournisseur","pk_reference","titre","categorie","couleur","pk_famille",' +
  '"libelle_famille","pk_famille","libelle_famille","prix_achat_brut",' +
  '"remise_pourcentage_achat_reel1","remise_pourcentage_achat_reel2",' +
  '"remise_pourcentage_achat_reel3","remise_pourcentage_achat","coefficient",' +
  '"prix_vente_ttc","diml","dimh","dimp","dimension","description_detaille",' +
  '"pk_dimension","newecotaxe_code_produit","disponible","prix_achat_net",' +
  '"newmontant_ecotaxe_ttc"';

const CATALOGUE = crlf([
  CATALOGUE_ENTETE,
  // Ligne réelle : net non émis, donc à reconstruire depuis le brut.
  '"45","SKU 34 - DREAMS FLY","38","SKU 34 2025","","48700","COUSSIN COOLING","","","6928","Lits","6929","Lits","31.38","0.00","0.00","0.00","0.000","3.1549","99.00","","","","","Matière : Mousse à mémoire","0","","0.00"',
  // Net fourni par Skara : il fait foi.
  '"46","SKU 12 - BENJI","39","SKU 12 2024","REF-B","48701","LIT BELLA","","Gris","6928","Lits","6930","Sommiers","200.00","10.00","5.00","0.00","0.000","2.5","499.00","","","","140x190","Sommier inclus","0","","1.00","171.00","12.30"',
  // Ni brut ni net : marge incalculable.
  '"47","SKU 20 - SM","40","SKU 20 2023","","48702","MATELAS SANS PRIX","","","6931","Matelas","6932","Matelas","","0.00","0.00","0.00","0.000","0","349.00","","","","","","0","","0.00"',
]);

const JOURNAL = crlf([
  '"VT";"19/09/2026";"4115009611";"411500";"FL20260900234";"Client E - FL20260900234";"1698.00";"";"EUR";"4115009611"',
  '"VT";"19/09/2026";"";"445717";"FL20260900234";"TVA collectée";"";"283.00";"EUR";"445717"',
  '"VT";"19/09/2026";"";"707005";"FL20260900234";"Vente marchandises";"";"1415.00";"EUR";"707005"',
]);

describe("Champ numéro de facture", () => {
  it("décompose une facture exportée en comptabilité", () => {
    expect(parseInvoiceNumberField("FM20240300435 (exportee)")).toEqual({
      docType: "facture",
      number: "FM20240300435",
      accountingState: "exportee",
      prefix: "FM",
    });
  });

  it("décompose une facture non encore exportée", () => {
    expect(parseInvoiceNumberField("FM20260900479 (non-exportee)")).toMatchObject({
      docType: "facture",
      number: "FM20260900479",
      accountingState: "non_exportee",
    });
  });

  it("reconnaît un avoir et conserve le numéro de sa facture", () => {
    expect(parseInvoiceNumberField("Avoir FM20260900435 (non-exportee)")).toMatchObject({
      docType: "avoir",
      number: "FM20260900435",
      accountingState: "non_exportee",
      prefix: "FM",
    });
  });

  it("reconnaît une pièce non émise, qui n'a pas de numéro", () => {
    expect(parseInvoiceNumberField("(non-emise)")).toEqual({
      docType: "non_emise",
      number: null,
      accountingState: null,
      prefix: null,
    });
  });

  it("accepte un numéro nu, comme dans l'export des lignes", () => {
    expect(parseInvoiceNumberField("FL20260900218")).toMatchObject({
      docType: "facture",
      number: "FL20260900218",
      accountingState: null,
      prefix: "FL",
    });
  });
});

describe("Liste des factures", () => {
  const result = parseInvoiceList(LISTE_FACTURES);

  it("lit toutes les pièces sans confondre le pied avec une donnée", () => {
    expect(result.rows).toHaveLength(5);
    expect(result.footer?.totalTtc).toBe("2969");
  });

  it("recoupe le total du pied et n'oppose aucun refus", () => {
    expect(result.computed.totalTtc).toBe(2969);
    expect(result.computed.totalHt).toBe(2474.166);
    expect(isBlocked(result.anomalies)).toBe(false);
  });

  it("distingue les trois natures de pièce", () => {
    expect(result.rows.map((r) => r.docType)).toEqual([
      "avoir",
      "facture",
      "facture",
      "non_emise",
      "facture",
    ]);
  });

  it("donne une clé de repli à la pièce sans numéro", () => {
    const sansNumero = result.rows.find((r) => r.docType === "non_emise");
    expect(sansNumero?.number).toBeNull();
    expect(sansNumero?.rowKey).toContain("sans-numero:");
    // La clé est déterministe : un réimport retombe dessus.
    expect(parseInvoiceList(LISTE_FACTURES).rows[3].rowKey).toBe(sansNumero?.rowKey);
  });

  it("relève le préfixe de magasin et la période", () => {
    expect(result.prefixes).toEqual(["FL"]);
    expect(result.period).toEqual({ start: "2026-09-02", end: "2026-09-19" });
  });

  it("distingue un champ vide d'un zéro", () => {
    const avoir = result.rows[0];
    expect(avoir.remainingDue).toEqual({ raw: null, value: null });
    expect(result.rows[1].remainingDue).toEqual({ raw: "0", value: 0 });
  });

  it("complète le dernier champ que Skara n'émet pas", () => {
    // La dernière ligne s'arrête après ECO TTC.
    expect(result.rows[4].serviceTtc).toEqual({ raw: null, value: null });
    expect(result.rows[4].ecoTtc.raw).toBe("7.50");
  });

  it("refuse un fichier dont le pied ne correspond pas", () => {
    const fausse = LISTE_FACTURES.replace(";;;;2969;", ";;;;9999;");
    const refuse = parseInvoiceList(fausse);
    expect(isBlocked(refuse.anomalies)).toBe(true);
    expect(refuse.anomalies.some((a) => a.kind === "total_incoherent")).toBe(true);
  });

  it("signale un montant négatif sur une facture qui n'est pas un avoir", () => {
    const suspecte = crlf([
      "NUMERO FACTURE;DATE;CLIENT;VENDEUR;TOTAL TTC;TOTAL HT;TVA;MARGE;RESTE A REGLER;ECO TTC;SERVICE TTC",
      "FL20260900999 (non-exportee);02-09-2026;Client F;;-100;-83.333;-16.667;0;0;0;0",
    ]);
    expect(
      parseInvoiceList(suspecte).anomalies.some(
        (a) => a.kind === "montant_negatif_sans_avoir",
      ),
    ).toBe(true);
  });

  it("signale une pièce présente deux fois", () => {
    const doublon = crlf([
      "NUMERO FACTURE;DATE;CLIENT;VENDEUR;TOTAL TTC;TOTAL HT;TVA;MARGE;RESTE A REGLER;ECO TTC;SERVICE TTC",
      "FL20260900218 (non-exportee);02-09-2026;Client B;;449.00;374.166;74.834;0;0;0;0",
      "FL20260900218 (non-exportee);02-09-2026;Client B;;449.00;374.166;74.834;0;0;0;0",
    ]);
    expect(
      parseInvoiceList(doublon).anomalies.some((a) => a.kind === "doublon_dans_le_fichier"),
    ).toBe(true);
  });

  it("signale un fichier qui mélange deux magasins", () => {
    const melange = crlf([
      "NUMERO FACTURE;DATE;CLIENT;VENDEUR;TOTAL TTC;TOTAL HT;TVA;MARGE;RESTE A REGLER;ECO TTC;SERVICE TTC",
      "FL20260900218 (non-exportee);02-09-2026;Client B;;449.00;374.166;74.834;0;0;0;0",
      "FM20260900218 (non-exportee);02-09-2026;Client C;;449.00;374.166;74.834;0;0;0;0",
    ]);
    const melangee = parseInvoiceList(melange);
    expect(melangee.prefixes.sort()).toEqual(["FL", "FM"]);
    expect(melangee.anomalies.some((a) => a.kind === "plusieurs_magasins")).toBe(true);
  });

  it("refuse un fichier qui n'est pas une liste de factures", () => {
    expect(isBlocked(parseInvoiceList("A;B;C\r\n1;2;3").anomalies)).toBe(true);
  });
});

describe("Lignes de factures", () => {
  const result = parseInvoiceLines(LIGNES_FACTURES);

  it("numérote les lignes facture par facture", () => {
    expect(result.rows).toHaveLength(6);
    expect(result.rows.filter((r) => r.invoiceNumber === "FM20260900435")).toHaveLength(4);
    expect(result.rows.map((r) => r.lineIndex)).toEqual([1, 2, 3, 4, 1, 2]);
  });

  it("lit le pied de fichier réparti sur deux lignes", () => {
    expect(result.footer?.totalPrice).toBe("3279");
    expect(result.computed.totalPrice).toBe(3279);
    expect(isBlocked(result.anomalies)).toBe(false);
  });

  it("propose une nature pour chaque ligne", () => {
    expect(result.rows.map((r) => r.natureProposed)).toEqual([
      "produit",
      "produit",
      "remise",
      "service",
      "produit",
      "remise",
    ]);
  });

  it("conserve le libellé complet, consignes comprises", () => {
    expect(result.rows[3].label).toContain("ATTENTION PAS DE CAMION");
  });

  it("refuse un fichier dont le prix total ne correspond pas", () => {
    const fausse = LIGNES_FACTURES.replace(";0;;0;3279;", ";0;;0;9999;");
    expect(isBlocked(parseInvoiceLines(fausse).anomalies)).toBe(true);
  });
});

describe("Nature proposée d'une ligne", () => {
  it("classe les services et les remises par leur libellé", () => {
    expect(proposeLineNature("LIVRAISON + INSTALLATION", 80)).toBe("service");
    expect(proposeLineNature("Remise fidélité", -50)).toBe("remise");
    expect(proposeLineNature("ECO PART 2024", 13.5)).toBe("eco");
  });

  it("classe en remise tout montant négatif non identifié", () => {
    expect(proposeLineNature("Ajustement", -10)).toBe("remise");
  });

  it("classe en produit par défaut, même un libellé qui parle d'annulation", () => {
    // « POUF ANNULE » reste facturé : le libellé ne décide pas du montant.
    expect(proposeLineNature("Pouf Vanessa POUF ANNULE", 399)).toBe("produit");
  });
});

describe("Coût net reconstruit", () => {
  it("applique les remises en cascade", () => {
    expect(computeNetCost(100, [10, 10, null]).net).toBe(81);
  });

  it("rend le brut quand aucune remise n'est renseignée", () => {
    expect(computeNetCost(31.38, [0, 0, 0]).net).toBe(31.38);
  });

  it("ignore une remise hors bornes et le signale", () => {
    const result = computeNetCost(100, [150, null, null]);
    expect(result.net).toBe(100);
    expect(result.suspicious).toBe(true);
  });

  it("ne devine rien sans prix d'achat brut", () => {
    expect(computeNetCost(null, [10]).net).toBeNull();
  });
});

describe("Catalogue des articles", () => {
  const result = parseArticles(CATALOGUE);

  it("lit la référence interne comme clé produit", () => {
    expect(result.rows.map((r) => r.reference)).toEqual(["48700", "48701", "48702"]);
    // La référence fournisseur, elle, peut être vide.
    expect(result.rows[0].supplierReference).toBeNull();
  });

  it("rattache l'article à son fournisseur et à sa famille", () => {
    expect(result.rows[0].supplierLabel).toBe("SKU 34 - DREAMS FLY");
    expect(result.rows[0].familyLabel).toBe("Lits");
    expect(result.rows[0].subfamilyLabel).toBe("Lits");
    expect(result.rows[1].subfamilyLabel).toBe("Sommiers");
  });

  it("reconstruit le coût net quand Skara ne l'émet pas", () => {
    const coussin = result.rows[0];
    expect(coussin.purchaseNetGiven.value).toBeNull();
    expect(coussin.netOrigin).toBe("reconstruit");
    expect(coussin.purchaseNetComputed.value).toBe(31.38);
  });

  it("garde le coût net de Skara quand il existe", () => {
    expect(result.rows[1].netOrigin).toBe("skara");
    expect(result.rows[1].purchaseNetGiven.raw).toBe("171.00");
  });

  it("marque comme absent un article sans aucun coût", () => {
    expect(result.rows[2].netOrigin).toBe("absent");
    expect(result.anomalies.some((a) => a.kind === "articles_sans_cout")).toBe(true);
  });

  it("documente le moteur de prix de Skara", () => {
    // Le prix de vente découle du prix d'achat BRUT par le coefficient.
    const { purchaseGross, coefficient, salePriceTtc } = result.rows[0];
    const calcule = (purchaseGross.value ?? 0) * (coefficient.value ?? 0);
    expect(Math.abs(calcule - (salePriceTtc.value ?? 0))).toBeLessThan(0.01);
  });

  it("refuse un fichier réduit à son en-tête et explique comment l'obtenir", () => {
    const enteteSeule = parseArticles(CATALOGUE_ENTETE + "\r\n");
    expect(isBlocked(enteteSeule.anomalies)).toBe(true);
    expect(
      enteteSeule.anomalies.some((a) => a.message.includes("lancez la recherche")),
    ).toBe(true);
  });

  it("refuse un fichier qui n'est pas un catalogue", () => {
    expect(isBlocked(parseArticles('"a","b"\r\n"1","2"').anomalies)).toBe(true);
  });
});

describe("Journal comptable", () => {
  const result = parseJournal(JOURNAL);

  it("lit les écritures sans en-tête ni pied", () => {
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].generalAccount).toBe("411500");
    expect(result.rows[0].piece).toBe("FL20260900234");
    expect(result.prefixes).toEqual(["VT"]);
  });

  it("vérifie l'équilibre du journal", () => {
    expect(result.computed.debit).toBe(1698);
    expect(result.computed.credit).toBe(1698);
    expect(isBlocked(result.anomalies)).toBe(false);
  });

  it("refuse un journal déséquilibré", () => {
    const casse = JOURNAL.replace('"1415.00"', '"1400.00"');
    const refuse = parseJournal(casse);
    expect(isBlocked(refuse.anomalies)).toBe(true);
    expect(refuse.anomalies.some((a) => a.kind === "journal_desequilibre")).toBe(true);
  });

  it("explique qu'un journal vide vient de l'export à consommation unique", () => {
    const vide = parseJournal("");
    expect(isBlocked(vide.anomalies)).toBe(true);
    expect(vide.anomalies[0].message).toContain("Historique");
  });
});
