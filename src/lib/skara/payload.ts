import type {
  Amount,
  Anomaly,
  ArticleRow,
  InvoiceLineRow,
  InvoiceRow,
  JournalEntryRow,
  ParsedFile,
  SkaraFileKind,
} from "./types";

/**
 * Conversion d'un fichier lu en charge utile pour la base.
 *
 * Deux décisions de conception, toutes deux pour éviter une mauvaise
 * surprise en production :
 *
 *   * les montants partent en CHAÎNES, exactement telles que Skara les a
 *     écrites. PostgreSQL les convertit une seule fois en numérique. Aucun
 *     flottant JavaScript ne s'interpose, donc aucun 916,6669999 possible ;
 *   * la ligne brute n'est PAS transmise. Toutes les colonnes utiles étant
 *     déjà nommées, la renvoyer doublerait le poids de la requête pour rien,
 *     et un export de trois ans compte près de quatre mille factures.
 */

/** Au-delà, l'export doit être découpé : une requête trop lourde échoue. */
export const MAX_ROWS = 20000;

function a(value: Amount): string | null {
  return value.raw;
}

export interface SkaraImportPayload {
  kind: SkaraFileKind;
  store_id?: string | null;
  file_name: string;
  content_hash: string;
  period: { start: string | null; end: string | null };
  footer: Record<string, string | null> | null;
  computed: Record<string, number>;
  prefixes: string[];
  anomalies: Anomaly[];
  rows: Record<string, unknown>[];
}

function invoiceRow(row: InvoiceRow): Record<string, unknown> {
  return {
    doc_type: row.docType,
    number: row.number,
    row_key: row.rowKey,
    accounting_state: row.accountingState,
    date: row.date,
    client_label: row.clientLabel,
    seller_label: row.sellerLabel,
    total_ttc: a(row.totalTtc),
    total_ht: a(row.totalHt),
    vat: a(row.vat),
    margin_skara: a(row.marginSkara),
    remaining_due: a(row.remainingDue),
    eco_ttc: a(row.ecoTtc),
    service_ttc: a(row.serviceTtc),
  };
}

function invoiceLineRow(row: InvoiceLineRow): Record<string, unknown> {
  return {
    invoice_number: row.invoiceNumber,
    line_index: row.lineIndex,
    date: row.date,
    label: row.label,
    quantity: row.quantity,
    unit_weight: a(row.unitWeight),
    total_weight: a(row.totalWeight),
    volume: a(row.volume),
    total_volume: a(row.totalVolume),
    total_price_ttc: a(row.totalPriceTtc),
    nature_proposed: row.natureProposed,
  };
}

function articleRow(row: ArticleRow): Record<string, unknown> {
  return {
    reference: row.reference,
    supplier_key: row.supplierKey,
    supplier_label: row.supplierLabel,
    supplier_reference: row.supplierReference,
    collection_key: row.collectionKey,
    collection_label: row.collectionLabel,
    title: row.title,
    category: row.category,
    color: row.color,
    family_key: row.familyKey,
    family_label: row.familyLabel,
    subfamily_key: row.subfamilyKey,
    subfamily_label: row.subfamilyLabel,
    purchase_gross: a(row.purchaseGross),
    discount1: a(row.discount1),
    discount2: a(row.discount2),
    discount3: a(row.discount3),
    discount_global: a(row.discountGlobal),
    coefficient: a(row.coefficient),
    sale_price_ttc: a(row.salePriceTtc),
    purchase_net_given: a(row.purchaseNetGiven),
    purchase_net_computed: a(row.purchaseNetComputed),
    net_origin: row.netOrigin,
    eco_amount_ttc: a(row.ecoAmountTtc),
    available: a(row.available),
    dimension: row.dimension,
    description: row.description,
  };
}

function journalRow(row: JournalEntryRow): Record<string, unknown> {
  return {
    row_index: row.rowIndex,
    journal_code: row.journalCode,
    date: row.date,
    auxiliary_account: row.auxiliaryAccount,
    general_account: row.generalAccount,
    piece: row.piece,
    label: row.label,
    debit: a(row.debit),
    credit: a(row.credit),
    currency: row.currency,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function buildPayload(
  parsed: ParsedFile<any>,
  options: { fileName: string; contentHash: string; storeId?: string | null },
): SkaraImportPayload {
  let rows: Record<string, unknown>[];
  switch (parsed.kind) {
    case "liste_factures":
      rows = (parsed.rows as InvoiceRow[]).map(invoiceRow);
      break;
    case "lignes_factures":
      rows = (parsed.rows as InvoiceLineRow[]).map(invoiceLineRow);
      break;
    case "catalogue":
      rows = (parsed.rows as ArticleRow[]).map(articleRow);
      break;
    default:
      rows = (parsed.rows as JournalEntryRow[]).map(journalRow);
      break;
  }

  return {
    kind: parsed.kind,
    store_id: options.storeId ?? null,
    file_name: options.fileName,
    content_hash: options.contentHash,
    period: parsed.period,
    footer: parsed.footer,
    computed: parsed.computed,
    prefixes: parsed.prefixes,
    anomalies: parsed.anomalies,
    rows,
  };
}

/** Résumé lisible d'une lecture, affiché avant toute écriture. */
export function summarize(parsed: ParsedFile<any>): Record<string, unknown> {
  return {
    nature: parsed.kind,
    lignes: parsed.rows.length,
    periode: parsed.period,
    prefixes: parsed.prefixes,
    pied: parsed.footer,
    calcule: parsed.computed,
    anomalies: parsed.anomalies,
    bloquant: parsed.anomalies.some((x) => x.severity === "bloquant"),
  };
}
