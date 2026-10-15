/**
 * Types des quatre exports Skara.
 *
 * Règle générale : les montants sont portés en DEUX exemplaires, la chaîne
 * exacte reçue de Skara et sa valeur numérique. La chaîne part en base, la
 * valeur ne sert qu'aux contrôles. Rien n'est recalculé.
 */

export type SkaraFileKind =
  | "liste_factures"
  | "lignes_factures"
  | "catalogue"
  | "journal_comptable";

export type DocType = "facture" | "avoir" | "non_emise";
export type AccountingState = "exportee" | "non_exportee";

export type AnomalySeverity = "info" | "avertissement" | "bloquant";

/**
 * Une anomalie constatée à la lecture. « bloquant » refuse le fichier :
 * c'est le cas du total de pied qui ne correspond pas, parce qu'un fichier
 * incohérent importé silencieusement fausse tout ce qui suit.
 */
export interface Anomaly {
  kind: string;
  severity: AnomalySeverity;
  message: string;
  payload?: Record<string, unknown>;
}

/** Montant conservé tel quel, plus sa valeur pour les contrôles. */
export interface Amount {
  raw: string | null;
  value: number | null;
}

export interface InvoiceNumberParts {
  docType: DocType;
  /** null pour une pièce non émise, qui n'a pas de numéro. */
  number: string | null;
  accountingState: AccountingState | null;
  /** Deux premières lettres du numéro : elles encodent le magasin. */
  prefix: string | null;
}

export interface InvoiceRow extends InvoiceNumberParts {
  rowIndex: number;
  date: string | null;
  clientLabel: string | null;
  sellerLabel: string | null;
  totalTtc: Amount;
  totalHt: Amount;
  vat: Amount;
  marginSkara: Amount;
  remainingDue: Amount;
  ecoTtc: Amount;
  serviceTtc: Amount;
  /** Clé de repli pour les pièces sans numéro, afin que le réimport soit sûr. */
  rowKey: string;
  raw: string[];
}

export type LineNature = "produit" | "remise" | "service" | "eco";

export interface InvoiceLineRow {
  invoiceNumber: string;
  lineIndex: number;
  date: string | null;
  label: string;
  quantity: number | null;
  unitWeight: Amount;
  totalWeight: Amount;
  volume: Amount;
  totalVolume: Amount;
  totalPriceTtc: Amount;
  natureProposed: LineNature;
  raw: string[];
}

export type NetCostOrigin = "skara" | "reconstruit" | "absent";

export interface ArticleRow {
  reference: string;
  supplierKey: string | null;
  supplierLabel: string | null;
  supplierReference: string | null;
  collectionKey: string | null;
  collectionLabel: string | null;
  title: string | null;
  category: string | null;
  color: string | null;
  familyKey: string | null;
  familyLabel: string | null;
  subfamilyKey: string | null;
  subfamilyLabel: string | null;
  purchaseGross: Amount;
  discount1: Amount;
  discount2: Amount;
  discount3: Amount;
  discountGlobal: Amount;
  coefficient: Amount;
  salePriceTtc: Amount;
  purchaseNetGiven: Amount;
  /** Coût net reconstruit à partir du brut et des remises, si Skara se taît. */
  purchaseNetComputed: Amount;
  netOrigin: NetCostOrigin;
  ecoAmountTtc: Amount;
  available: Amount;
  dimension: string | null;
  description: string | null;
  raw: string[];
}

export interface JournalEntryRow {
  rowIndex: number;
  journalCode: string;
  date: string | null;
  auxiliaryAccount: string | null;
  generalAccount: string;
  piece: string | null;
  label: string | null;
  debit: Amount;
  credit: Amount;
  currency: string | null;
  raw: string[];
}

/** Résultat commun d'une lecture de fichier. */
export interface ParsedFile<T> {
  kind: SkaraFileKind;
  rows: T[];
  /** Totaux lus dans la ligne de pied, quand le fichier en a une. */
  footer: Record<string, string | null> | null;
  /** Totaux recalculés à partir des lignes, pour comparaison. */
  computed: Record<string, number>;
  period: { start: string | null; end: string | null };
  /** Préfixes de numéro rencontrés : ils doivent désigner un seul magasin. */
  prefixes: string[];
  anomalies: Anomaly[];
}
