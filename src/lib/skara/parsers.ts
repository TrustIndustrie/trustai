import { amount, detectDelimiter, field, isoDate, parseCsv } from "./csv";
import type {
  Anomaly,
  ArticleRow,
  InvoiceLineRow,
  InvoiceNumberParts,
  InvoiceRow,
  JournalEntryRow,
  LineNature,
  NetCostOrigin,
  ParsedFile,
  SkaraFileKind,
} from "./types";

/**
 * Lecture des quatre exports Skara.
 *
 * Aucun de ces analyseurs n'écrit en base ni ne contacte Skara : ce sont des
 * fonctions pures, donc entièrement testables sur vos fichiers réels.
 *
 * Deux principes tenus partout :
 *
 *   * on ne recalcule jamais un montant reçu, on le transmet tel quel ;
 *   * une incohérence est SIGNALÉE, jamais absorbée. Un fichier dont le
 *     total de pied ne correspond pas à la somme de ses lignes est refusé,
 *     parce qu'un import silencieusement faux fausse toute la gestion.
 */

/** Tolérance de comparaison des totaux : un centime. */
export const TOTAL_TOLERANCE = 0.01;

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Numéro de facture : trois informations collées dans un seul champ
// ---------------------------------------------------------------------------

/**
 * « Avoir FM20260900435 (non-exportee) » porte le type, le numéro et l'état
 * comptable. « (non-emise) » est une pièce de gestion sans numéro, absente
 * de la comptabilité. Sans cette décomposition, un même numéro ne se
 * retrouverait jamais d'un export à l'autre.
 */
export function parseInvoiceNumberField(value: string): InvoiceNumberParts {
  const source = value.trim();
  let rest = source;
  let accountingState: InvoiceNumberParts["accountingState"] = null;
  let docType: InvoiceNumberParts["docType"] = "facture";

  const parenthetical = rest.match(/\(([^)]*)\)\s*$/);
  if (parenthetical) {
    const marker = parenthetical[1].trim().toLowerCase();
    rest = rest.slice(0, parenthetical.index).trim();
    if (marker === "non-emise" || marker === "non emise") {
      docType = "non_emise";
    } else if (marker === "exportee") {
      accountingState = "exportee";
    } else if (marker === "non-exportee" || marker === "non exportee") {
      accountingState = "non_exportee";
    }
  }

  const avoir = rest.match(/^avoir\s+(.*)$/i);
  if (avoir) {
    docType = "avoir";
    rest = avoir[1].trim();
  }

  if (rest === "") {
    // Aucun numéro : c'est une pièce non émise, quel que soit le marqueur.
    return { docType: "non_emise", number: null, accountingState, prefix: null };
  }
  const prefix = /^[A-Za-z]{2}/.test(rest) ? rest.slice(0, 2).toUpperCase() : null;
  return { docType, number: rest, accountingState, prefix };
}

/**
 * Clé de repli pour une pièce sans numéro : sans elle, réimporter un fichier
 * qui chevauche le précédent dupliquerait ces lignes.
 */
function fallbackKey(parts: string[]): string {
  return `sans-numero:${parts.map((p) => p.trim().toLowerCase()).join("|")}`;
}

// ---------------------------------------------------------------------------
// 0. Reconnaissance de la nature réelle du fichier
// ---------------------------------------------------------------------------

/** Intitulés lisibles, identiques à ceux du sélecteur de l'écran d'import. */
export const KIND_LABELS: Record<SkaraFileKind, string> = {
  liste_factures: "Liste des factures",
  lignes_factures: "Lignes de factures",
  catalogue: "Catalogue des articles",
  journal_comptable: "Journal comptable",
};

/**
 * Nature réelle du fichier, lue dans son en-tête.
 *
 * Deux exports Skara commencent par « NUMERO FACTURE » : seule la troisième
 * colonne les sépare. Sans cette reconnaissance, déposer la liste alors que
 * les lignes sont sélectionnées ne donne qu'un « en-tête inattendu », qui
 * n'indique pas quoi corriger.
 *
 * Le journal n'a pas d'en-tête : il n'est pas reconnaissable et renvoie
 * null, faute de quoi on l'affirmerait à tort.
 */
export function detectFileKind(content: string): SkaraFileKind | null {
  const firstLine = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trim() === "") return null;
  const cells = parseCsv(firstLine, detectDelimiter(firstLine))[0] ?? [];
  const upper = cells.map((c) => c.trim().toUpperCase());
  if (field(upper, 0) === "PK_FOURNISSEUR") return "catalogue";
  if (field(upper, 0) === "NUMERO FACTURE") {
    return field(upper, 2) === "LIBELLE PRODUIT" ? "lignes_factures" : "liste_factures";
  }
  return null;
}

/**
 * Anomalie bloquante quand le fichier déposé n'est pas de la nature choisie.
 * Retourne null quand rien ne permet de l'affirmer.
 */
export function mismatchAnomaly(
  selected: SkaraFileKind,
  content: string,
): Anomaly | null {
  const detected = detectFileKind(content);
  if (detected === null || detected === selected) return null;
  return {
    kind: "nature_de_fichier_incorrecte",
    severity: "bloquant",
    message: `Ce fichier est un export « ${KIND_LABELS[detected]} », alors que « ${KIND_LABELS[selected]} » est sélectionné. Changez la nature du fichier, puis relancez l'analyse.`,
    payload: { choisi: selected, reconnu: detected },
  };
}

// ---------------------------------------------------------------------------
// 1. Liste des factures
// ---------------------------------------------------------------------------

const INVOICE_COLUMNS = [
  "NUMERO FACTURE",
  "DATE",
  "CLIENT",
  "VENDEUR",
  "TOTAL TTC",
  "TOTAL HT",
  "TVA",
  "MARGE",
  "RESTE A REGLER",
  "ECO TTC",
  "SERVICE TTC",
];

export function parseInvoiceList(content: string): ParsedFile<InvoiceRow> {
  const table = parseCsv(content, ";");
  const anomalies: Anomaly[] = [];
  const rows: InvoiceRow[] = [];
  let footer: Record<string, string | null> | null = null;

  if (table.length === 0) {
    anomalies.push({
      kind: "fichier_vide",
      severity: "bloquant",
      message: "Le fichier ne contient aucune ligne.",
    });
    return emptyResult("liste_factures", anomalies);
  }

  const header = table[0].map((c) => c.trim().toUpperCase());
  if (field(header, 0) !== "NUMERO FACTURE") {
    anomalies.push({
      kind: "entete_inattendue",
      severity: "bloquant",
      message:
        "La première colonne ne s'appelle pas « NUMERO FACTURE » : ce fichier n'est pas une liste de factures.",
      payload: { attendu: INVOICE_COLUMNS[0], recu: field(header, 0) },
    });
    return emptyResult("liste_factures", anomalies);
  }

  const seen = new Map<string, number>();
  let sumTtc = 0;
  let sumHt = 0;
  let sumVat = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  const prefixes = new Set<string>();

  for (let i = 1; i < table.length; i += 1) {
    const row = table[i];
    const first = field(row, 0);

    if (first.toUpperCase() === "TOTAUX") {
      footer = {
        totalTtc: amount(field(row, 4)).raw,
        totalHt: amount(field(row, 5)).raw,
        vat: amount(field(row, 6)).raw,
        marginSkara: amount(field(row, 7)).raw,
        remainingDue: amount(field(row, 8)).raw,
        ecoTtc: amount(field(row, 9)).raw,
        serviceTtc: amount(field(row, 10)).raw,
      };
      continue;
    }
    if (first === "") continue;

    const parts = parseInvoiceNumberField(first);
    const date = isoDate(field(row, 1));
    const clientLabel = text(field(row, 2));
    const totalTtc = amount(field(row, 4));

    if (date === null) {
      anomalies.push({
        kind: "date_illisible",
        severity: "avertissement",
        message: `Date illisible sur la pièce « ${first} ».`,
        payload: { ligne: i + 1, valeur: field(row, 1) },
      });
    } else {
      if (minDate === null || date < minDate) minDate = date;
      if (maxDate === null || date > maxDate) maxDate = date;
    }

    const rowKey =
      parts.number ??
      fallbackKey([field(row, 1), clientLabel ?? "", totalTtc.raw ?? ""]);

    const dedupKey = `${parts.docType}|${rowKey}`;
    const already = seen.get(dedupKey);
    if (already !== undefined) {
      anomalies.push({
        kind: "doublon_dans_le_fichier",
        severity: "avertissement",
        message: `La pièce « ${first} » apparaît deux fois dans le fichier.`,
        payload: { lignes: [already, i + 1] },
      });
    }
    seen.set(dedupKey, i + 1);

    if (parts.prefix) prefixes.add(parts.prefix);

    if (parts.docType === "facture" && (totalTtc.value ?? 0) < 0) {
      anomalies.push({
        kind: "montant_negatif_sans_avoir",
        severity: "avertissement",
        message: `La facture « ${first} » porte un montant négatif sans être un avoir.`,
        payload: { ligne: i + 1, montant: totalTtc.raw },
      });
    }

    sumTtc += totalTtc.value ?? 0;
    sumHt += amount(field(row, 5)).value ?? 0;
    sumVat += amount(field(row, 6)).value ?? 0;

    rows.push({
      ...parts,
      rowIndex: i,
      date,
      clientLabel,
      sellerLabel: text(field(row, 3)),
      totalTtc,
      totalHt: amount(field(row, 5)),
      vat: amount(field(row, 6)),
      marginSkara: amount(field(row, 7)),
      remainingDue: amount(field(row, 8)),
      ecoTtc: amount(field(row, 9)),
      serviceTtc: amount(field(row, 10)),
      rowKey,
      raw: row,
    });
  }

  const computed = { totalTtc: round3(sumTtc), totalHt: round3(sumHt), vat: round3(sumVat) };
  checkFooter(anomalies, footer?.totalTtc ?? null, computed.totalTtc, "toutes taxes");
  checkFooter(anomalies, footer?.totalHt ?? null, computed.totalHt, "hors taxes");

  if (prefixes.size > 1) {
    anomalies.push({
      kind: "plusieurs_magasins",
      severity: "avertissement",
      message: `Le fichier mélange plusieurs préfixes de numéro (${Array.from(prefixes).join(", ")}), donc probablement plusieurs magasins.`,
      payload: { prefixes: Array.from(prefixes) },
    });
  }

  return {
    kind: "liste_factures",
    rows,
    footer,
    computed,
    period: { start: minDate, end: maxDate },
    prefixes: Array.from(prefixes),
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// 2. Lignes de factures
// ---------------------------------------------------------------------------

/**
 * Nature proposée d'une ligne. Une ligne de facture n'est pas toujours un
 * produit : vos fichiers contiennent des remises en montant négatif, des
 * services de livraison et l'éco-participation. Le seul indice disponible
 * étant un libellé libre, la nature est PROPOSÉE ici et confirmée par un
 * humain, jamais décidée définitivement.
 */
export function proposeLineNature(label: string, total: number | null): LineNature {
  const upper = label.toUpperCase();
  if (/ECO[\s-]?PART|ECOTAXE|ECO[\s-]?PARTICIPATION|EP\s?20\d\d/.test(upper)) return "eco";
  if (/LIVRAISON|INSTALLATION|TRANSPORT|MONTAGE|REPRISE|SAV/.test(upper)) return "service";
  if (/REMISE|PROMO|GESTE|RISTOURNE|AVOIR/.test(upper)) return "remise";
  if ((total ?? 0) < 0) return "remise";
  return "produit";
}

export function parseInvoiceLines(content: string): ParsedFile<InvoiceLineRow> {
  const table = parseCsv(content, ";");
  const anomalies: Anomaly[] = [];
  const rows: InvoiceLineRow[] = [];
  let footer: Record<string, string | null> | null = null;

  if (table.length === 0) {
    anomalies.push({
      kind: "fichier_vide",
      severity: "bloquant",
      message: "Le fichier ne contient aucune ligne.",
    });
    return emptyResult("lignes_factures", anomalies);
  }

  const header = table[0].map((c) => c.trim().toUpperCase());
  if (field(header, 0) !== "NUMERO FACTURE" || field(header, 2) !== "LIBELLE PRODUIT") {
    anomalies.push({
      kind: "entete_inattendue",
      severity: "bloquant",
      message:
        "L'en-tête ne correspond pas à un export des lignes de factures (« NUMERO FACTURE » puis « LIBELLE PRODUIT » attendus).",
      payload: { recu: header.slice(0, 3) },
    });
    return emptyResult("lignes_factures", anomalies);
  }

  const perInvoice = new Map<string, number>();
  let sumPrice = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  const prefixes = new Set<string>();
  let footerLabels: string[] | null = null;

  for (let i = 1; i < table.length; i += 1) {
    const row = table[i];
    const first = field(row, 0);

    // Le pied de ce fichier tient sur deux lignes sans numéro : d'abord les
    // libellés (« Prix Total »), puis les valeurs, alignées sur eux.
    if (first === "") {
      const joined = row.join(" ").toUpperCase();
      if (joined.includes("PRIX TOTAL")) {
        footerLabels = row.map((c) => c.trim().toUpperCase());
        continue;
      }
      if (footerLabels) {
        const index = footerLabels.findIndex((c) => c === "PRIX TOTAL");
        footer = { totalPrice: index >= 0 ? amount(field(row, index)).raw : null };
      }
      continue;
    }

    const parts = parseInvoiceNumberField(first);
    if (parts.prefix) prefixes.add(parts.prefix);
    if (!parts.number) {
      anomalies.push({
        kind: "ligne_sans_numero",
        severity: "avertissement",
        message: `Ligne ${i + 1} sans numéro de facture exploitable : écartée.`,
        payload: { valeur: first },
      });
      continue;
    }

    const date = isoDate(field(row, 1));
    if (date) {
      if (minDate === null || date < minDate) minDate = date;
      if (maxDate === null || date > maxDate) maxDate = date;
    }

    const label = field(row, 2);
    const quantityRaw = amount(field(row, 3));
    const totalPriceTtc = amount(field(row, 8));
    const lineIndex = (perInvoice.get(parts.number) ?? 0) + 1;
    perInvoice.set(parts.number, lineIndex);
    sumPrice += totalPriceTtc.value ?? 0;

    rows.push({
      invoiceNumber: parts.number,
      lineIndex,
      date,
      label,
      quantity: quantityRaw.value === null ? null : Math.trunc(quantityRaw.value),
      unitWeight: amount(field(row, 4)),
      totalWeight: amount(field(row, 5)),
      volume: amount(field(row, 6)),
      totalVolume: amount(field(row, 7)),
      totalPriceTtc,
      natureProposed: proposeLineNature(label, totalPriceTtc.value),
      raw: row,
    });
  }

  const computed = { totalPrice: round3(sumPrice) };
  checkFooter(anomalies, footer?.totalPrice ?? null, computed.totalPrice, "prix total");

  return {
    kind: "lignes_factures",
    rows,
    footer,
    computed,
    period: { start: minDate, end: maxDate },
    prefixes: Array.from(prefixes),
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// 3. Catalogue des articles
// ---------------------------------------------------------------------------

/**
 * Coût net reconstruit à partir du brut et des trois remises en cascade.
 *
 * HYPOTHÈSE EXPLICITE : les trois colonnes « remise_pourcentage_achat_reel »
 * sont des POURCENTAGES. Sur l'échantillon disponible elles valent toutes
 * zéro, ce qui ne permet pas de le vérifier. Le résultat est donc toujours
 * marqué « reconstruit », jamais confondu avec une valeur reçue de Skara, et
 * une remise hors de l'intervalle 0 à 100 déclenche une anomalie.
 */
export function computeNetCost(
  gross: number | null,
  discounts: (number | null)[],
): { net: number | null; suspicious: boolean } {
  if (gross === null) return { net: null, suspicious: false };
  let net = gross;
  let suspicious = false;
  for (const discount of discounts) {
    if (discount === null || discount === 0) continue;
    if (discount < 0 || discount > 100) {
      suspicious = true;
      continue;
    }
    net = net * (1 - discount / 100);
  }
  return { net: Math.round(net * 10000) / 10000, suspicious };
}

const ARTICLE_COLUMN_COUNT = 30;

export function parseArticles(content: string): ParsedFile<ArticleRow> {
  const table = parseCsv(content, ",");
  const anomalies: Anomaly[] = [];
  const rows: ArticleRow[] = [];

  if (table.length === 0) {
    anomalies.push({
      kind: "fichier_vide",
      severity: "bloquant",
      message: "Le fichier ne contient aucune ligne.",
    });
    return emptyResult("catalogue", anomalies);
  }

  const header = table[0].map((c) => c.trim().toLowerCase());
  if (field(header, 0) !== "pk_fournisseur" || !header.includes("prix_achat_brut")) {
    anomalies.push({
      kind: "entete_inattendue",
      severity: "bloquant",
      message:
        "L'en-tête ne correspond pas à un export du catalogue (« pk_fournisseur » et « prix_achat_brut » attendus).",
      payload: { recu: header.slice(0, 3) },
    });
    return emptyResult("catalogue", anomalies);
  }
  if (header.length !== ARTICLE_COLUMN_COUNT) {
    anomalies.push({
      kind: "nombre_de_colonnes_inattendu",
      severity: "avertissement",
      message: `L'en-tête compte ${header.length} colonnes au lieu de ${ARTICLE_COLUMN_COUNT} : Skara a peut-être changé son export.`,
    });
  }

  if (table.length === 1) {
    anomalies.push({
      kind: "aucune_ligne_de_donnee",
      severity: "bloquant",
      message:
        "Le fichier ne contient que son en-tête. Sur l'écran des articles, lancez la recherche et sélectionnez les articles avant d'exporter.",
    });
  }

  const seen = new Set<string>();
  let withoutCost = 0;
  let reconstructed = 0;

  for (let i = 1; i < table.length; i += 1) {
    const row = table[i];
    const reference = field(row, 5);
    if (reference === "") {
      anomalies.push({
        kind: "article_sans_reference",
        severity: "avertissement",
        message: `Ligne ${i + 1} sans référence interne : écartée.`,
      });
      continue;
    }
    if (seen.has(reference)) {
      anomalies.push({
        kind: "doublon_dans_le_fichier",
        severity: "avertissement",
        message: `La référence ${reference} apparaît deux fois dans le fichier.`,
      });
    }
    seen.add(reference);

    const purchaseGross = amount(field(row, 13));
    const discount1 = amount(field(row, 14));
    const discount2 = amount(field(row, 15));
    const discount3 = amount(field(row, 16));
    const purchaseNetGiven = amount(field(row, 28));
    const { net, suspicious } = computeNetCost(purchaseGross.value, [
      discount1.value,
      discount2.value,
      discount3.value,
    ]);

    if (suspicious) {
      anomalies.push({
        kind: "remise_hors_bornes",
        severity: "avertissement",
        message: `Remise d'achat hors de l'intervalle 0 à 100 sur la référence ${reference} : ignorée dans le calcul.`,
      });
    }

    let netOrigin: NetCostOrigin;
    if (purchaseNetGiven.value !== null && purchaseNetGiven.value > 0) {
      netOrigin = "skara";
    } else if (net !== null && net > 0) {
      netOrigin = "reconstruit";
      reconstructed += 1;
    } else {
      netOrigin = "absent";
      withoutCost += 1;
    }

    rows.push({
      reference,
      supplierKey: text(field(row, 0)),
      supplierLabel: text(field(row, 1)),
      collectionKey: text(field(row, 2)),
      collectionLabel: text(field(row, 3)),
      supplierReference: text(field(row, 4)),
      title: text(field(row, 6)),
      category: text(field(row, 7)),
      color: text(field(row, 8)),
      familyKey: text(field(row, 9)),
      familyLabel: text(field(row, 10)),
      subfamilyKey: text(field(row, 11)),
      subfamilyLabel: text(field(row, 12)),
      purchaseGross,
      discount1,
      discount2,
      discount3,
      discountGlobal: amount(field(row, 17)),
      coefficient: amount(field(row, 18)),
      salePriceTtc: amount(field(row, 19)),
      purchaseNetGiven,
      purchaseNetComputed: {
        raw: net === null ? null : String(net),
        value: net,
      },
      netOrigin,
      ecoAmountTtc: amount(field(row, 29)),
      available: amount(field(row, 27)),
      dimension: text(field(row, 23)),
      description: text(field(row, 24)),
      raw: row,
    });
  }

  if (withoutCost > 0) {
    anomalies.push({
      kind: "articles_sans_cout",
      severity: "info",
      message: `${withoutCost} article(s) sans coût d'achat exploitable : leur marge ne pourra pas être calculée.`,
      payload: { nombre: withoutCost },
    });
  }
  if (reconstructed > 0) {
    anomalies.push({
      kind: "cout_net_reconstruit",
      severity: "info",
      message: `${reconstructed} article(s) dont le coût net a été reconstruit depuis le brut et les remises.`,
      payload: { nombre: reconstructed },
    });
  }

  return {
    kind: "catalogue",
    rows,
    footer: null,
    computed: { articles: rows.length, sansCout: withoutCost, reconstruits: reconstructed },
    period: { start: null, end: null },
    prefixes: [],
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// 4. Journal comptable
// ---------------------------------------------------------------------------

/**
 * Le journal n'a NI en-tête NI pied. Son contrôle propre est l'équilibre :
 * un journal dont le débit ne rejoint pas le crédit n'est pas exploitable.
 */
export function parseJournal(content: string): ParsedFile<JournalEntryRow> {
  const table = parseCsv(content, ";");
  const anomalies: Anomaly[] = [];
  const rows: JournalEntryRow[] = [];

  if (table.length === 0) {
    anomalies.push({
      kind: "fichier_vide",
      severity: "bloquant",
      message:
        "Le fichier est vide. Un export comptable ne ressort que les écritures pas encore exportées : passez par l'Historique de Skara pour retélécharger un export existant.",
    });
    return emptyResult("journal_comptable", anomalies);
  }

  let sumDebit = 0;
  let sumCredit = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  const journals = new Set<string>();

  for (let i = 0; i < table.length; i += 1) {
    const row = table[i];
    const journalCode = field(row, 0);
    const generalAccount = field(row, 3);
    if (journalCode === "" || generalAccount === "") {
      anomalies.push({
        kind: "ecriture_incomplete",
        severity: "avertissement",
        message: `Ligne ${i + 1} sans code journal ou sans compte général : écartée.`,
      });
      continue;
    }
    journals.add(journalCode);
    const date = isoDate(field(row, 1));
    if (date) {
      if (minDate === null || date < minDate) minDate = date;
      if (maxDate === null || date > maxDate) maxDate = date;
    } else {
      anomalies.push({
        kind: "date_illisible",
        severity: "avertissement",
        message: `Date illisible à la ligne ${i + 1}.`,
        payload: { valeur: field(row, 1) },
      });
    }

    const debit = amount(field(row, 6));
    const credit = amount(field(row, 7));
    sumDebit += debit.value ?? 0;
    sumCredit += credit.value ?? 0;

    rows.push({
      rowIndex: i,
      journalCode,
      date,
      auxiliaryAccount: text(field(row, 2)),
      generalAccount,
      piece: text(field(row, 4)),
      label: text(field(row, 5)),
      debit,
      credit,
      currency: text(field(row, 8)),
      raw: row,
    });
  }

  const computed = { debit: round3(sumDebit), credit: round3(sumCredit) };
  if (Math.abs(computed.debit - computed.credit) > TOTAL_TOLERANCE) {
    anomalies.push({
      kind: "journal_desequilibre",
      severity: "bloquant",
      message: `Journal déséquilibré : ${computed.debit.toFixed(2)} au débit contre ${computed.credit.toFixed(2)} au crédit.`,
      payload: computed,
    });
  }

  return {
    kind: "journal_comptable",
    rows,
    footer: null,
    computed,
    period: { start: minDate, end: maxDate },
    prefixes: Array.from(journals),
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// Aides communes
// ---------------------------------------------------------------------------

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function checkFooter(
  anomalies: Anomaly[],
  footerRaw: string | null,
  computed: number,
  label: string,
): void {
  if (footerRaw === null) return;
  const expected = Number(footerRaw);
  if (!Number.isFinite(expected)) return;
  const gap = Math.abs(expected - computed);
  if (gap > TOTAL_TOLERANCE) {
    anomalies.push({
      kind: "total_incoherent",
      severity: "bloquant",
      message: `Le total ${label} du pied de fichier (${expected}) ne correspond pas à la somme des lignes (${computed}). Fichier refusé.`,
      payload: { pied: expected, calcule: computed, ecart: round3(gap) },
    });
  }
}

function emptyResult<T>(
  kind: ParsedFile<T>["kind"],
  anomalies: Anomaly[],
): ParsedFile<T> {
  return {
    kind,
    rows: [],
    footer: null,
    computed: {},
    period: { start: null, end: null },
    prefixes: [],
    anomalies,
  };
}

/** true si une anomalie interdit l'écriture. */
export function isBlocked(anomalies: Anomaly[]): boolean {
  return anomalies.some((a) => a.severity === "bloquant");
}
