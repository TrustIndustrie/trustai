/**
 * Modèle de données TRUST AI.
 *
 * Toutes les entités utilisent des identifiants stables (string) et des
 * relations explicites par id, afin de pouvoir remplacer plus tard le
 * stockage localStorage par Supabase sans réécrire l'interface.
 */

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export interface Store {
  id: string;
  /** Code court utilisé dans les références de commande (LIS, HER, AUB). */
  code: string;
  name: string;
  city: string;
  /** Anciens noms rencontrés dans les documents (ex. Aubagne = "Marseille"). */
  aliases: string[];
  active: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  city: string;
  /**
   * Magasins habituellement desservis par ce dépôt. Association souple :
   * Herblay est aujourd'hui lié au dépôt d'Argenteuil mais les deux entités
   * restent séparées dans le modèle.
   */
  linkedStoreIds: string[];
  active: boolean;
  notes?: string;
}

export interface Salesperson {
  id: string;
  name: string;
  storeId: string;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  postalCode?: string;
  city?: string;
}

// ---------------------------------------------------------------------------
// Commandes clients
// ---------------------------------------------------------------------------

export type OrderOrigin = "SHOPIFY" | "MAGASIN";

export type FulfillmentMode = "livraison" | "retrait_magasin" | "retrait_depot";

export type DeliveryStatus =
  | "a_planifier"
  | "planifiee"
  | "en_cours"
  | "livree"
  | "prete_retrait"
  | "retiree"
  | "reportee"
  | "annulee";

export type OrderStatus = "ouverte" | "terminee" | "annulee";

/** Statut d'approvisionnement suivi article par article. */
export type ProcurementStatus =
  | "a_verifier"
  | "stock_local"
  | "a_commander"
  | "en_attente_validation"
  | "commande"
  | "indisponible"
  | "relance_due"
  | "pret_fournisseur"
  | "en_transport"
  | "recu_depot"
  | "annule";

export type AcquisitionSource =
  | "google_naturel"
  | "google_ads"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "bouche_a_oreille"
  | "passage_magasin"
  | "ancien_client"
  | "autre";

/**
 * Détails propres aux commandes Shopify.
 *
 * NOTE INTÉGRATION FUTURE : dans la version connectée, ces commandes seront
 * reçues automatiquement via les webhooks Shopify (orders/create,
 * orders/updated) et stockées dans Supabase. Les champs ci-dessous sont
 * alignés sur la payload Shopify pour faciliter ce branchement.
 */
export interface ShopifyDetails {
  shopifyId: string;
  orderNumber: string;
  paymentStatusShopify?: string;
  fulfillmentStatusShopify?: string;
  landingPage?: string;
  firstVisitAt?: string;
  lastVisitAt?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  daysToConversion?: number;
  returningCustomer?: boolean;
}

export interface Order {
  id: string;
  /** Référence lisible : MAG-LIS-2026-0001 ou numéro Shopify (#TR1058). */
  reference: string;
  origin: OrderOrigin;
  /** Magasin de rattachement (obligatoire pour l'origine MAGASIN). */
  storeId?: string;
  /** Vendeuse / vendeur (obligatoire pour une commande magasin). */
  salespersonId?: string;
  customerId: string;
  orderedAt: string;
  desiredAt?: string;
  fulfillmentMode: FulfillmentMode;
  deliveryStatus: DeliveryStatus;
  /** Dépôt ou magasin de retrait / point de départ de la livraison. */
  fulfillmentLocationLabel?: string;
  deliveryFee: number;
  /** Remise globale sur la commande, en euros. */
  discount: number;
  acquisitionSource?: AcquisitionSource;
  shopify?: ShopifyDetails;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  /** Profil employé ayant créé la commande (phase Supabase Auth). */
  createdByProfileId?: string;
}

/**
 * Ligne de commande : chaque article a son propre suivi d'approvisionnement.
 * Une commande n'est jamais modélisée comme une seule ligne produit.
 */
export interface OrderLine {
  id: string;
  orderId: string;
  /** Rattachement au catalogue centralisé (absent pour les lignes libres). */
  productId?: string;
  variantId?: string;
  /** Ligne saisie manuellement, hors catalogue (clairement signalée). */
  offCatalog?: boolean;
  productName: string;
  variant?: string;
  reference?: string;
  quantity: number;
  /** Prix unitaire TTC en euros. */
  unitPrice: number;
  /** Remise sur la ligne, en euros (montant total pour la ligne). */
  discount: number;
  /** Fournisseur principal pressenti pour cet article. */
  supplierId?: string;
  /** Fournisseur alternatif éventuel. */
  altSupplierId?: string;
  procurementStatus: ProcurementStatus;
  expectedArrival?: string;
  destinationWarehouseId?: string;
  /** Commande fournisseur à laquelle la ligne est rattachée, le cas échéant. */
  supplierOrderId?: string;
  /** Suivi des relances du lundi. */
  lastReminderAt?: string;
  nextReminderAt?: string;
  comments?: string;
}

// ---------------------------------------------------------------------------
// Catalogue produits
// ---------------------------------------------------------------------------

export type ProductCategory =
  | "canapes"
  | "tables"
  | "chaises"
  | "lits"
  | "matelas"
  | "fauteuils"
  | "decoration"
  | "luminaires";

export type ProductSource = "shopify" | "manuel";

/**
 * Produit du catalogue centralisé. Les champs Shopify sont facultatifs :
 * ils seront renseignés lors de la future synchronisation (webhooks +
 * API Admin). Pour l'instant la synchronisation est simulée.
 */
export interface Product {
  id: string;
  shopifyProductId?: string;
  title: string;
  shortDescription?: string;
  category: ProductCategory;
  imageUrl?: string;
  shopifyHandle?: string;
  source: ProductSource;
  active: boolean;
  lastSyncedAt?: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode?: string;
  color?: string;
  /** Libellé COMMERCIAL des dimensions (issu du catalogue ou de Shopify). */
  dimensions?: string;
  /** Prix de vente TTC en euros. */
  price: number;
  shopifyVariantId?: string;
  /**
   * Référentiel LOGISTIQUE (phase 1) : caractéristiques de l'article
   * emballé, utilisées par la future planification des tournées. Écrites
   * uniquement par la fonction serveur `set_variant_logistics` en mode
   * connecté — jamais par une mise à jour directe depuis le navigateur.
   */
  logistics?: VariantLogistics;
}

/**
 * Compteurs du module logistique (phase 1). Servis par la fonction serveur
 * `logistics_summary()`, cloisonnée par organisation : aucune table
 * logistique n'est lisible directement depuis le navigateur.
 */
export interface LogisticsSummary {
  lignesTotal: number;
  lignesDisponibles: number;
  dossiersTotal: number;
  dossiersAContacter: number;
  anomaliesOuvertes: number;
  documentsAVerifier: number;
}

// ---------------------------------------------------------------------------
// Récapitulatif Google Sheets (phase 2)
// ---------------------------------------------------------------------------

/**
 * Un ONGLET du récapitulatif (lecture seule côté TRUST AI).
 *
 * Le fichier réel est organisé par année : « INTERNET » pour l'année en
 * cours, « SUIVIS 2025 » pour la précédente, et un nouvel onglet apparaîtra
 * en janvier. Chaque onglet est donc une source à part entière, avec sa
 * propre correspondance de colonnes et son propre historique de lectures.
 */
export interface RecapSource {
  id: string;
  label: string;
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
  /** Colonne « ID TRUST », alimentée par l'Apps Script installé dans le Sheet. */
  idColumn?: string;
  /**
   * Correspondance « champ métier → colonne ». La valeur est un TITRE de
   * colonne ou une LETTRE (« G », « AB ») : le fichier réel comporte des
   * colonnes sans titre et deux colonnes homonymes.
   */
  columnMapping: Record<string, string>;
  /**
   * Transporteurs qui livrent le client depuis Paris (OMAR, GEODIS…).
   * Éditable ici plutôt que codé en dur : la liste change chaque année.
   */
  clientCarriers: string[];
  active: boolean;
  /** Nombre de lignes déjà importées depuis cet onglet. */
  linesCount: number;
  lastReadAt?: string;
  lastReadStatus?: string;
  lastRead?: RecapReadReport;
}

export interface RecapReadReport {
  startedAt: string;
  finishedAt?: string;
  rowsRead: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsIgnored: number;
  errorsCount: number;
  report: Record<string, number>;
}

export interface RecapSourceInput {
  /** Absent = nouvel onglet ; renseigné = mise à jour de celui-ci. */
  id?: string;
  label: string;
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
  idColumn?: string;
  columnMapping: Record<string, string>;
  clientCarriers: string[];
}

/** Par quel chemin le client a été servi (les trois sont exclusifs). */
export type ExitChannel = "paris" | "livraison_aubagne" | "retrait_aubagne";

export interface LogisticsLineFilters {
  search?: string;
  stage?: string;
  supplier?: string;
  warehouseId?: string;
  onlyAnomalies?: boolean;
  limit?: number;
  offset?: number;
  /** Restreindre à un onglet du récapitulatif. */
  sourceId?: string;
  exitChannel?: ExitChannel;
}

/** Ligne du récapitulatif telle qu'affichée dans la liste. */
export interface LogisticsLineRow {
  id: string;
  recap_row_id?: string;
  recap_date?: string;
  supplier_label?: string;
  supplier_reference?: string;
  /** Numéro de commande FOURNISSEUR (colonne « ORDER »), jamais le client. */
  supplier_order_ref?: string;
  designation: string;
  quantity: number;
  customer_label?: string;
  expected_at?: string;
  comments?: string;
  stage: string;
  destination_confidence: string;
  destination_label?: string;
  current_label?: string;
  missing_since?: string;
  last_seen_at?: string;
  last_changed_at?: string;
  open_anomalies: number;
  /** Renseigné dès que la marchandise est partie chez le client. */
  exit_channel?: ExitChannel;
  exit_at?: string;
  /** Numéro d'affrètement du transfert Argenteuil → Aubagne (« E243 »). */
  freight_ref?: string;
  source_id?: string;
}

export interface LogisticsLinePage {
  total: number;
  rows: LogisticsLineRow[];
}

export interface LogisticsLineDetail {
  line: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  anomalies: Record<string, unknown>[];
}

/**
 * Caractéristiques logistiques d'une variante (toutes facultatives).
 *
 * Convention de mise à jour, identique côté serveur :
 *   * champ ABSENT → valeur conservée ;
 *   * champ à `null` → valeur EFFACÉE (vidage volontaire) ;
 *   * champ renseigné → validé (entiers uniquement, jamais arrondis).
 */
export interface VariantLogistics {
  /** Poids de l'article emballé, en grammes. */
  weightGrams?: number | null;
  /** Dimensions EMBALLÉES, en millimètres. */
  packedLengthMm?: number | null;
  packedWidthMm?: number | null;
  packedHeightMm?: number | null;
  /** Volume en cm³ (calculé côté serveur si les 3 dimensions sont fournies). */
  volumeCm3?: number | null;
  packageCount?: number | null;
  fragile?: boolean | null;
  requiresInstallation?: boolean | null;
  /** Nombre de livreurs conseillé (1 à 4). */
  recommendedHandlers?: number | null;
  handlingNotes?: string | null;
  verifiedAt?: string;
  verifiedBy?: string;
}

// ---------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------

export type SupplierChannel = "whatsapp" | "site" | "application" | "email";

export type SupplierLogistics =
  | "retrait_trust"
  | "livraison_fournisseur"
  | "les_deux";

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  country?: string;
  specialties: string[];
  website?: string;
  orderChannel: SupplierChannel;
  /** Lien de consultation du stock (catalogue B2B). Aucun identifiant stocké. */
  stockUrl?: string;
  usualOrderDay?: string;
  pickupDays: string[];
  leadTimeDays?: number;
  active: boolean;
  logistics: SupplierLogistics;
  comments?: string;
}

/**
 * Association produit ↔ fournisseur. Un produit peut avoir un fournisseur
 * principal et plusieurs alternatifs, avec référence, délai et priorité
 * propres à chaque fournisseur. Servira à l'agent IA pour proposer un
 * fournisseur de repli en cas de rupture.
 */
export interface ProductSupplier {
  id: string;
  /** Rattachement au catalogue (facultatif pour les produits hors catalogue). */
  productId?: string;
  variantId?: string;
  productName: string;
  variant?: string;
  supplierId: string;
  supplierReference?: string;
  leadTimeDays?: number;
  /** 1 = fournisseur principal, 2+ = alternatifs par ordre de priorité. */
  priority: number;
  isPrimary: boolean;
}

// ---------------------------------------------------------------------------
// Commandes fournisseurs
// ---------------------------------------------------------------------------

export type SupplierOrderStatus =
  | "proposition"
  | "en_attente_validation"
  | "validee"
  | "confirmee"
  | "annulee";

export interface SupplierOrderLine {
  id: string;
  /** Ligne de commande client à l'origine du besoin (traçabilité). */
  orderLineId?: string;
  productName: string;
  variant?: string;
  supplierReference?: string;
  quantity: number;
  /**
   * Prix d'achat unitaire (euros). Jamais inventé : absent tant que le prix
   * n'a pas été renseigné — l'interface affiche alors un avertissement
   * « Prix d'achat non renseigné ».
   */
  unitCost?: number;
}

/**
 * Commande fournisseur : regroupe plusieurs lignes destinées au même
 * fournisseur. Doit TOUJOURS être validée par un humain avant d'être
 * considérée comme envoyée — le système prépare une proposition mais ne
 * simule jamais un envoi réel.
 */
export interface SupplierOrder {
  id: string;
  reference: string;
  supplierId: string;
  status: SupplierOrderStatus;
  lines: SupplierOrderLine[];
  createdAt: string;
  validatedAt?: string;
  validatedBy?: string;
  expectedAt?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Logistique : arrivages, transports, mouvements entre dépôts
// ---------------------------------------------------------------------------

export type ShipmentStatus =
  | "a_organiser"
  | "programme"
  | "pret_fournisseur"
  | "recupere"
  | "en_transit"
  | "recu_partiellement"
  | "recu"
  | "retarde"
  | "annule";

export type TransportMode =
  | "retrait_trust"
  | "livraison_fournisseur"
  | "affretement";

export type ShipmentEndpointType =
  | "fournisseur"
  | "depot"
  | "magasin"
  | "client";

export interface ShipmentItem {
  id: string;
  orderLineId?: string;
  productName: string;
  variant?: string;
  quantity: number;
  /** Permet les réceptions partielles. */
  quantityReceived: number;
}

/**
 * Étape d'un parcours logistique. Un transport peut être composé de
 * plusieurs étapes, par exemple :
 * Fournisseur → dépôt d'Argenteuil → affrètement → dépôt d'Aubagne → client.
 */
export interface ShipmentLeg {
  id: string;
  shipmentId: string;
  sequence: number;
  originType: ShipmentEndpointType;
  originLabel: string;
  destinationType: ShipmentEndpointType;
  destinationLabel: string;
  mode: TransportMode;
  carrier?: string;
  charterReference?: string;
  plannedAt?: string;
  actualAt?: string;
  status: ShipmentStatus;
}

/**
 * Arrivage / mouvement logistique. Peut contenir plusieurs commandes ou
 * articles, et être découpé en étapes (legs).
 */
export interface Shipment {
  id: string;
  reference: string;
  supplierId?: string;
  /** Dépôt principal concerné (destination courante). */
  warehouseId?: string;
  originLabel: string;
  destinationLabel: string;
  mode: TransportMode;
  carrier?: string;
  charterReference?: string;
  plannedAt?: string;
  actualAt?: string;
  status: ShipmentStatus;
  items: ShipmentItem[];
  legs: ShipmentLeg[];
  comments?: string;
}

// ---------------------------------------------------------------------------
// Règlements
// ---------------------------------------------------------------------------

export type PaymentMethod =
  | "especes"
  | "virement"
  | "carte_bancaire"
  | "paiement_express"
  | "cofidis"
  | "pnf"
  | "alma"
  | "floa"
  | "avoir"
  /** Encaissement en ligne reçu automatiquement via webhook Shopify. */
  | "shopify"
  | "autre";

export type PaymentStatus =
  | "a_payer"
  | "partiellement_paye"
  | "paye"
  | "rembourse"
  /** Commande annulée après encaissement : remboursement ou avoir à traiter. */
  | "remboursement_a_traiter"
  /** Commande annulée sans aucun règlement : aucun remboursement nécessaire. */
  | "sans_objet";

/**
 * Ligne de règlement. Une commande peut avoir plusieurs règlements ;
 * le reste à payer (RAP) est toujours calculé, jamais saisi.
 * Un montant négatif représente un remboursement.
 */
export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  storeId?: string;
  salespersonId?: string;
  /** Profil employé ayant encaissé (phase Supabase Auth). */
  receivedByProfileId?: string;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Acquisition marketing
// ---------------------------------------------------------------------------

export interface AcquisitionJourney {
  id: string;
  orderId: string;
  source: AcquisitionSource;
  landingPage?: string;
  firstVisitAt?: string;
  lastVisitAt?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  daysToConversion?: number;
  newCustomer?: boolean;
}

// ---------------------------------------------------------------------------
// Validations humaines & journal d'activité
// ---------------------------------------------------------------------------

export type ApprovalType =
  | "commande_fournisseur"
  | "changement_fournisseur"
  | "annulation_commande"
  | "reaffectation_produit"
  | "reservation_affretement"
  | "message_externe"
  | "modification_commande";

export type ApprovalStatus = "en_attente" | "approuvee" | "refusee";

/**
 * Demande de validation humaine. Aucune action extérieure réelle n'est
 * exécutée dans cette version : approuver une demande met simplement à jour
 * les statuts internes et le journal d'activité.
 */
export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  title: string;
  description: string;
  relatedOrderId?: string;
  relatedSupplierOrderId?: string;
  relatedShipmentId?: string;
  /** Personne (ou système) ayant demandé l'action. */
  requestedBy?: string;
  /** Profil employé demandeur (mode connecté). */
  requestedByProfileId?: string;
  /** Montant en jeu (ex. montant déjà encaissé pour une annulation). */
  financialImpact?: number;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Motif saisi lors de la décision (obligatoire moralement pour un refus). */
  decisionReason?: string;
}

export interface ActivityLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  details?: string;
  orderId?: string;
}

// ---------------------------------------------------------------------------
// Comptes employés (préparation Supabase Auth — phase suivante)
// ---------------------------------------------------------------------------

/**
 * Rôles prévus pour la phase d'authentification. Aucune fausse
 * authentification n'est implémentée dans cette version : ces types
 * préparent uniquement le schéma et les relations.
 */
export type Role =
  | "vendeur"
  | "responsable_magasin"
  | "achats"
  | "logistique"
  | "comptabilite"
  | "direction"
  | "administrateur"
  // Phase 1 — socle logistique.
  | "responsable_logistique"
  | "livreur";

export type Permission =
  | "creer_commande"
  | "encaisser_reglement"
  | "valider_decision"
  | "gerer_achats"
  | "gerer_logistique"
  | "gerer_encaissements"
  | "voir_acquisition"
  | "gerer_catalogue"
  | "produit_hors_catalogue"
  | "voir_tous_magasins"
  | "administrer"
  // Phase 1 — socle logistique (7 permissions).
  | "gerer_livraisons"
  | "importer_recap"
  | "gerer_documents_client"
  | "voir_coordonnees_client"
  | "voir_montants_livraison"
  | "executer_livraison"
  | "gerer_referentiel_logistique";

/**
 * Profil employé. À la phase Supabase Auth, `authUserId` pointera vers
 * l'utilisateur connecté et remplacera le choix manuel de la
 * vendeuse/du vendeur dans les formulaires.
 */
export interface UserProfile {
  id: string;
  /** Identifiant Supabase Auth (renseigné en phase 2). */
  authUserId?: string;
  displayName: string;
  role: Role;
  /** Magasin principal de rattachement. */
  primaryStoreId?: string;
  /** Magasins sur lesquels le profil peut travailler. */
  allowedStoreIds: string[];
  /** Lien avec la fiche vendeuse/vendeur existante, le cas échéant. */
  salespersonId?: string;
  active: boolean;
}

/**
 * Matrice de permissions centralisée et testable.
 * La même matrice est portée côté PostgreSQL (fonction `app.role_permissions`
 * des migrations Supabase) : les rôles ne sont jamais purement visuels, les
 * restrictions sont vérifiées côté serveur et dans la base.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  vendeur: ["creer_commande", "encaisser_reglement"],
  responsable_magasin: [
    "creer_commande",
    "encaisser_reglement",
    "valider_decision",
    "gerer_encaissements",
    "voir_acquisition",
    "produit_hors_catalogue",
    "voir_coordonnees_client",
  ],
  achats: [
    "gerer_achats",
    "valider_decision",
    "gerer_catalogue",
    "gerer_referentiel_logistique",
  ],
  logistique: ["gerer_logistique", "gerer_livraisons", "voir_coordonnees_client"],
  comptabilite: ["gerer_encaissements", "voir_montants_livraison"],
  // Phase 1 : pilote du module logistique.
  responsable_logistique: [
    "gerer_logistique",
    "gerer_livraisons",
    "importer_recap",
    "gerer_documents_client",
    "voir_coordonnees_client",
    "voir_montants_livraison",
    "executer_livraison",
    "gerer_referentiel_logistique",
    "valider_decision",
  ],
  // Phase 1 : AUCUNE permission (décision E18). Les droits du livreur seront
  // ouverts en phase 6, avec la relation livreur ↔ passage et ses tests RLS.
  livreur: [],
  direction: [
    "creer_commande",
    "encaisser_reglement",
    "valider_decision",
    "gerer_achats",
    "gerer_logistique",
    "gerer_encaissements",
    "voir_acquisition",
    "gerer_catalogue",
    "produit_hors_catalogue",
    "voir_tous_magasins",
    "gerer_livraisons",
    "importer_recap",
    "gerer_documents_client",
    "voir_coordonnees_client",
    "voir_montants_livraison",
    "executer_livraison",
    "gerer_referentiel_logistique",
  ],
  administrateur: [
    "creer_commande",
    "encaisser_reglement",
    "valider_decision",
    "gerer_achats",
    "gerer_logistique",
    "gerer_encaissements",
    "voir_acquisition",
    "gerer_catalogue",
    "produit_hors_catalogue",
    "voir_tous_magasins",
    "administrer",
    "gerer_livraisons",
    "importer_recap",
    "gerer_documents_client",
    "voir_coordonnees_client",
    "voir_montants_livraison",
    "executer_livraison",
    "gerer_referentiel_logistique",
  ],
};

// ---------------------------------------------------------------------------
// Base de données de démonstration
// ---------------------------------------------------------------------------

export interface Database {
  /** Version du schéma local : un changement force le rechargement du seed. */
  version: number;
  stores: Store[];
  warehouses: Warehouse[];
  salespeople: Salesperson[];
  userProfiles: UserProfile[];
  products: Product[];
  productVariants: ProductVariant[];
  customers: Customer[];
  orders: Order[];
  orderLines: OrderLine[];
  suppliers: Supplier[];
  productSuppliers: ProductSupplier[];
  supplierOrders: SupplierOrder[];
  shipments: Shipment[];
  payments: Payment[];
  acquisitionJourneys: AcquisitionJourney[];
  approvalRequests: ApprovalRequest[];
  activityLog: ActivityLog[];
}
