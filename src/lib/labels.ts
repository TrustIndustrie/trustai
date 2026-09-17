import type {
  AcquisitionSource,
  ApprovalStatus,
  ApprovalType,
  DeliveryStatus,
  FulfillmentMode,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProcurementStatus,
  ProductCategory,
  ProductSource,
  Role,
  ShipmentStatus,
  SupplierChannel,
  SupplierLogistics,
  SupplierOrderStatus,
  TransportMode,
} from "./types";

/** Couleur sémantique utilisée par le composant Badge. */
export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "violet";

export const procurementStatusLabels: Record<
  ProcurementStatus,
  { label: string; tone: BadgeTone }
> = {
  a_verifier: { label: "À vérifier", tone: "neutral" },
  stock_local: { label: "Stock local", tone: "success" },
  a_commander: { label: "À commander", tone: "warning" },
  en_attente_validation: { label: "En attente de validation", tone: "violet" },
  commande: { label: "Commandé", tone: "info" },
  indisponible: { label: "Indisponible", tone: "danger" },
  relance_due: { label: "Relance due", tone: "danger" },
  pret_fournisseur: { label: "Prêt chez le fournisseur", tone: "info" },
  en_transport: { label: "En transport", tone: "info" },
  recu_depot: { label: "Reçu au dépôt", tone: "success" },
  annule: { label: "Annulé", tone: "neutral" },
};

export const deliveryStatusLabels: Record<
  DeliveryStatus,
  { label: string; tone: BadgeTone }
> = {
  a_planifier: { label: "À planifier", tone: "warning" },
  planifiee: { label: "Planifiée", tone: "info" },
  en_cours: { label: "En cours", tone: "info" },
  livree: { label: "Livrée", tone: "success" },
  prete_retrait: { label: "Prête au retrait", tone: "info" },
  retiree: { label: "Retirée", tone: "success" },
  reportee: { label: "Reportée", tone: "warning" },
  annulee: { label: "Annulée", tone: "neutral" },
};

export const shipmentStatusLabels: Record<
  ShipmentStatus,
  { label: string; tone: BadgeTone }
> = {
  a_organiser: { label: "À organiser", tone: "warning" },
  programme: { label: "Programmé", tone: "info" },
  pret_fournisseur: { label: "Prêt chez le fournisseur", tone: "info" },
  recupere: { label: "Récupéré", tone: "info" },
  en_transit: { label: "En transit", tone: "info" },
  recu_partiellement: { label: "Reçu partiellement", tone: "warning" },
  recu: { label: "Reçu", tone: "success" },
  retarde: { label: "Retardé", tone: "danger" },
  annule: { label: "Annulé", tone: "neutral" },
};

export const supplierOrderStatusLabels: Record<
  SupplierOrderStatus,
  { label: string; tone: BadgeTone }
> = {
  proposition: { label: "Proposition", tone: "neutral" },
  en_attente_validation: { label: "En attente de validation", tone: "violet" },
  validee: { label: "Validée", tone: "success" },
  confirmee: { label: "Confirmée fournisseur", tone: "success" },
  annulee: { label: "Annulée", tone: "neutral" },
};

export const paymentStatusLabels: Record<
  PaymentStatus,
  { label: string; tone: BadgeTone }
> = {
  a_payer: { label: "À payer", tone: "danger" },
  partiellement_paye: { label: "Partiellement payé", tone: "warning" },
  paye: { label: "Payé", tone: "success" },
  rembourse: { label: "Remboursé", tone: "neutral" },
  remboursement_a_traiter: {
    label: "Remboursement ou avoir à traiter",
    tone: "danger",
  },
  sans_objet: { label: "Aucun remboursement nécessaire", tone: "neutral" },
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  especes: "Espèces",
  virement: "Virement",
  carte_bancaire: "Carte bancaire",
  paiement_express: "Paiement express",
  cofidis: "Cofidis",
  pnf: "PNF",
  alma: "Alma",
  floa: "Floa",
  avoir: "Avoir",
  shopify: "Shopify (en ligne)",
  autre: "Autre",
};

export const fulfillmentModeLabels: Record<FulfillmentMode, string> = {
  livraison: "Livraison",
  retrait_magasin: "Retrait magasin",
  retrait_depot: "Retrait dépôt",
};

export const orderStatusLabels: Record<
  OrderStatus,
  { label: string; tone: BadgeTone }
> = {
  ouverte: { label: "En cours", tone: "info" },
  terminee: { label: "Terminée", tone: "success" },
  annulee: { label: "Annulée", tone: "neutral" },
};

export const acquisitionSourceLabels: Record<AcquisitionSource, string> = {
  google_naturel: "Google naturel",
  google_ads: "Google Ads",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  bouche_a_oreille: "Bouche-à-oreille",
  passage_magasin: "Passage devant le magasin",
  ancien_client: "Ancien client",
  autre: "Autre",
};

export const supplierChannelLabels: Record<SupplierChannel, string> = {
  whatsapp: "WhatsApp",
  site: "Site internet",
  application: "Application",
  email: "E-mail",
};

export const supplierLogisticsLabels: Record<SupplierLogistics, string> = {
  retrait_trust: "Retrait par Trust",
  livraison_fournisseur: "Livraison par le fournisseur",
  les_deux: "Retrait ou livraison",
};

export const transportModeLabels: Record<TransportMode, string> = {
  retrait_trust: "Retrait Trust",
  livraison_fournisseur: "Livraison fournisseur",
  affretement: "Affrètement",
};

export const approvalTypeLabels: Record<ApprovalType, string> = {
  commande_fournisseur: "Commande fournisseur",
  changement_fournisseur: "Changement de fournisseur",
  annulation_commande: "Annulation de commande",
  reaffectation_produit: "Réaffectation de produit",
  reservation_affretement: "Réservation d'affrètement",
  message_externe: "Envoi de message externe",
  modification_commande: "Modification de commande",
};

export const approvalStatusLabels: Record<
  ApprovalStatus,
  { label: string; tone: BadgeTone }
> = {
  en_attente: { label: "En attente de validation", tone: "violet" },
  approuvee: { label: "Validée", tone: "success" },
  refusee: { label: "Refusée", tone: "neutral" },
};

export const originLabels: Record<"SHOPIFY" | "MAGASIN", string> = {
  SHOPIFY: "Shopify",
  MAGASIN: "Magasin",
};

export const productCategoryLabels: Record<ProductCategory, string> = {
  canapes: "Canapés",
  tables: "Tables",
  chaises: "Chaises",
  lits: "Lits",
  matelas: "Matelas",
  fauteuils: "Fauteuils",
  decoration: "Décoration",
  luminaires: "Luminaires",
};

export const productSourceLabels: Record<
  ProductSource,
  { label: string; tone: BadgeTone }
> = {
  shopify: { label: "Shopify", tone: "info" },
  manuel: { label: "Manuel", tone: "neutral" },
};

export const roleLabels: Record<Role, string> = {
  vendeur: "Vendeuse / vendeur",
  responsable_magasin: "Responsable magasin",
  achats: "Achats",
  logistique: "Logistique",
  comptabilite: "Comptabilité",
  responsable_logistique: "Responsable logistique",
  livreur: "Livreur",
  direction: "Direction",
  administrateur: "Administrateur",
};

/**
 * Étapes d'une ligne du récapitulatif (phase 2). L'étape décrit OÙ se trouve
 * la marchandise ; les retards et les anomalies sont suivis séparément.
 */
/**
 * Les trois façons de servir un client, telles que le récapitulatif les
 * distingue. Elles sont exclusives : une ligne servie par l'une n'est plus
 * disponible pour les autres.
 */
export const exitChannelLabels: Record<string, { label: string; tone: BadgeTone }> = {
  paris: { label: "Servi par Paris", tone: "info" },
  livraison_aubagne: { label: "Livré depuis Aubagne", tone: "info" },
  retrait_aubagne: { label: "Retiré à Aubagne", tone: "neutral" },
};

export const logisticsStageLabels: Record<string, { label: string; tone: BadgeTone }> = {
  a_commander: { label: "À commander", tone: "warning" },
  commandee: { label: "Commandée", tone: "info" },
  attendue: { label: "Attendue", tone: "info" },
  recue_argenteuil: { label: "Reçue à Argenteuil", tone: "info" },
  en_transfert: { label: "En transfert vers Aubagne", tone: "info" },
  recue_aubagne: { label: "Reçue à Aubagne", tone: "info" },
  disponible: { label: "Disponible", tone: "success" },
  sortie: { label: "Sortie", tone: "neutral" },
  annulee: { label: "Annulée", tone: "neutral" },
};
