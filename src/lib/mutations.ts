import { orderPaidCents, orderRapCents, pendingCancellation } from "./derive";
import { nextMonday } from "./format";
import { fromCents, toCents } from "./money";
import type {
  ActivityLog,
  Customer,
  Database,
  Order,
  OrderLine,
  Payment,
  ProcurementStatus,
  VariantLogistics,
} from "./types";

/**
 * Mutations métier pures : elles modifient un brouillon de base de données
 * (déjà cloné par l'appelant) et lèvent une `BusinessError` avec un message
 * en français lorsqu'une règle métier est violée.
 *
 * Cette couche est indépendante de React : elle est appelée par le
 * DataProvider côté interface et directement par les tests unitaires.
 * À la phase Supabase, ces règles seront rejouées côté serveur.
 */

export class BusinessError extends Error {}

/** Générateur d'identifiants stables pour la démo. */
export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export function logActivity(
  db: Database,
  entry: Omit<ActivityLog, "id" | "at"> & { at?: string },
): void {
  db.activityLog.unshift({
    id: uid("log"),
    at: entry.at ?? new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    details: entry.details,
    orderId: entry.orderId,
  });
}

function nextReference(existing: string[], prefix: string): string {
  const seq =
    existing
      .filter((r) => r.startsWith(prefix))
      .map((r) => parseInt(r.slice(prefix.length), 10))
      .filter((n) => !Number.isNaN(n))
      .reduce((max, n) => Math.max(max, n), 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Règlements
// ---------------------------------------------------------------------------

export interface PaymentInput {
  amount: number;
  date: string;
  method: Payment["method"];
  storeId?: string;
  salespersonId?: string;
  comment?: string;
}

/**
 * Enregistre un règlement en appliquant les règles métier :
 * - montant strictement supérieur à zéro ;
 * - jamais supérieur au RAP de la commande (pas de plafonnement silencieux :
 *   la tentative est refusée avec un message clair) ;
 * - aucun règlement sur une commande annulée ou dont le RAP est nul.
 */
export function addPaymentM(
  db: Database,
  orderId: string,
  input: PaymentInput,
): Payment {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new BusinessError("Commande introuvable.");
  if (order.status === "annulee") {
    throw new BusinessError(
      "Cette commande est annulée : aucun règlement ne peut être ajouté. Le remboursement ou l'avoir sera traité séparément.",
    );
  }
  const amountCents = toCents(input.amount);
  if (!Number.isFinite(input.amount) || amountCents <= 0) {
    throw new BusinessError(
      "Le montant d'un règlement doit être strictement supérieur à zéro.",
    );
  }
  const rapCents = orderRapCents(order, db.orderLines, db.payments);
  if (rapCents <= 0) {
    throw new BusinessError(
      "Cette commande est déjà soldée (RAP de 0 €) : aucun règlement supplémentaire ne peut être enregistré.",
    );
  }
  if (amountCents > rapCents) {
    throw new BusinessError(
      `Le règlement (${fromCents(amountCents).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}) dépasse le reste à payer (${fromCents(rapCents).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}). Corrigez le montant.`,
    );
  }

  const payment: Payment = {
    id: uid("pay"),
    orderId,
    amount: fromCents(amountCents),
    date: input.date,
    method: input.method,
    storeId: input.storeId ?? order.storeId,
    salespersonId: input.salespersonId ?? order.salespersonId,
    comment: input.comment,
  };
  db.payments.push(payment);
  logActivity(db, {
    actor: "Équipe magasin",
    action: "Règlement enregistré",
    details: `${order.reference} — règlement de ${fromCents(amountCents).toLocaleString("fr-FR")} €.`,
    orderId,
  });
  return payment;
}

// ---------------------------------------------------------------------------
// Création de commande magasin
// ---------------------------------------------------------------------------

export interface NewOrderLineInput {
  productId?: string;
  variantId?: string;
  offCatalog?: boolean;
  productName: string;
  variant?: string;
  reference?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  supplierId?: string;
  altSupplierId?: string;
  destinationWarehouseId?: string;
  comments?: string;
}

export interface NewStoreOrderInput {
  storeId: string;
  salespersonId: string;
  orderedAt: string;
  desiredAt?: string;
  customer: Omit<Customer, "id">;
  fulfillmentMode: Order["fulfillmentMode"];
  deliveryFee: number;
  discount: number;
  acquisitionSource?: Order["acquisitionSource"];
  notes?: string;
  lines: NewOrderLineInput[];
  payments: Omit<PaymentInput, "storeId">[];
}

export function createStoreOrderM(
  db: Database,
  input: NewStoreOrderInput,
): Order {
  if (!input.salespersonId) {
    throw new BusinessError("La vendeuse ou le vendeur est obligatoire.");
  }
  if (input.lines.length === 0) {
    throw new BusinessError("Une commande doit contenir au moins un article.");
  }

  const store = db.stores.find((s) => s.id === input.storeId);
  const code = store?.code ?? "MAG";
  const year = new Date().getFullYear();
  const reference = nextReference(
    db.orders.map((o) => o.reference),
    `MAG-${code}-${year}-`,
  );

  // Contrôle des règlements saisis à la création (mêmes règles qu'ensuite).
  const totalCents =
    input.lines.reduce(
      (sum, l) =>
        sum + Math.round(l.quantity * toCents(l.unitPrice)) - toCents(l.discount || 0),
      0,
    ) -
    toCents(input.discount || 0) +
    toCents(input.deliveryFee || 0);
  const paidCents = input.payments.reduce((s, p) => s + toCents(p.amount), 0);
  if (input.payments.some((p) => toCents(p.amount) <= 0)) {
    throw new BusinessError(
      "Chaque règlement doit avoir un montant strictement supérieur à zéro.",
    );
  }
  if (paidCents > totalCents) {
    throw new BusinessError(
      "Le total des règlements dépasse le total de la commande.",
    );
  }

  const customer: Customer = { id: uid("cus"), ...input.customer };
  const orderId = uid("ord");
  const order: Order = {
    id: orderId,
    reference,
    origin: "MAGASIN",
    storeId: input.storeId,
    salespersonId: input.salespersonId,
    customerId: customer.id,
    orderedAt: input.orderedAt,
    desiredAt: input.desiredAt,
    fulfillmentMode: input.fulfillmentMode,
    deliveryStatus: "a_planifier",
    deliveryFee: input.deliveryFee,
    discount: input.discount,
    acquisitionSource: input.acquisitionSource,
    status: "ouverte",
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };

  db.customers.push(customer);
  db.orders.push(order);

  for (const line of input.lines) {
    const newLine: OrderLine = {
      id: uid("line"),
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      offCatalog: line.offCatalog || undefined,
      productName: line.productName,
      variant: line.variant || undefined,
      reference: line.reference || undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      supplierId: line.supplierId || undefined,
      altSupplierId: line.altSupplierId || undefined,
      procurementStatus: "a_verifier",
      destinationWarehouseId: line.destinationWarehouseId || undefined,
      comments: line.comments || undefined,
    };
    db.orderLines.push(newLine);
  }

  for (const payment of input.payments) {
    db.payments.push({
      id: uid("pay"),
      orderId,
      amount: payment.amount,
      date: payment.date,
      method: payment.method,
      storeId: input.storeId,
      salespersonId: payment.salespersonId ?? input.salespersonId,
      comment: payment.comment,
    });
  }

  if (input.acquisitionSource) {
    db.acquisitionJourneys.push({
      id: uid("acq"),
      orderId,
      source: input.acquisitionSource,
      newCustomer: true,
    });
  }

  const salesperson = db.salespeople.find((s) => s.id === input.salespersonId);
  logActivity(db, {
    actor: salesperson?.name ?? "Équipe magasin",
    action: "Commande créée",
    details: `${reference} — ${input.lines.length} article(s), saisie magasin.`,
    orderId,
  });
  return order;
}

// ---------------------------------------------------------------------------
// Annulation de commande (avec validation humaine)
// ---------------------------------------------------------------------------

export function requestOrderCancellationM(
  db: Database,
  orderId: string,
  requestedBy = "Équipe magasin",
): void {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new BusinessError("Commande introuvable.");
  if (order.status === "annulee") {
    throw new BusinessError("Cette commande est déjà annulée.");
  }
  if (pendingCancellation(db, orderId)) {
    throw new BusinessError(
      "Une demande d'annulation est déjà en attente de validation pour cette commande.",
    );
  }
  const paid = fromCents(orderPaidCents(order, db.payments));
  db.approvalRequests.unshift({
    id: uid("apr"),
    type: "annulation_commande",
    title: `Annuler la commande ${order.reference}`,
    description:
      paid > 0
        ? `L'annulation nécessite une validation humaine. ${paid.toLocaleString("fr-FR")} € ont déjà été encaissés : un remboursement ou un avoir sera à traiter.`
        : "L'annulation d'une commande client est une décision importante : elle nécessite une validation humaine.",
    relatedOrderId: orderId,
    requestedBy,
    financialImpact: paid,
    status: "en_attente",
    createdAt: new Date().toISOString(),
  });
  logActivity(db, {
    actor: requestedBy,
    action: "Demande d'annulation créée",
    details: `${order.reference} — en attente de validation.`,
    orderId,
  });
}

// ---------------------------------------------------------------------------
// Décision sur une demande de validation
// ---------------------------------------------------------------------------

export interface DecideApprovalOptions {
  /**
   * Date d'arrivée estimée confirmée ou ajustée par le responsable lors de
   * la validation d'une commande fournisseur (ISO).
   */
  expectedAt?: string;
}

export function decideApprovalM(
  db: Database,
  requestId: string,
  approved: boolean,
  actor: string,
  reason?: string,
  options?: DecideApprovalOptions,
): void {
  const request = db.approvalRequests.find((r) => r.id === requestId);
  if (!request) throw new BusinessError("Demande introuvable.");
  if (request.status !== "en_attente") {
    throw new BusinessError("Cette demande a déjà été traitée.");
  }
  // Décision sur une annulation : le motif est OBLIGATOIRE, que la demande
  // soit validée ou refusée (traçabilité de l'impact financier).
  if (request.type === "annulation_commande" && !reason?.trim()) {
    throw new BusinessError(
      "Le motif est obligatoire pour valider ou refuser une annulation de commande.",
    );
  }
  // Personne ne valide sa propre demande d'annulation (même règle côté
  // PostgreSQL en mode connecté, comparée sur les profils authentifiés).
  if (
    request.type === "annulation_commande" &&
    request.requestedBy &&
    request.requestedBy === actor
  ) {
    throw new BusinessError(
      "Vous ne pouvez pas valider ou refuser votre propre demande d'annulation.",
    );
  }
  request.status = approved ? "approuvee" : "refusee";
  request.decidedAt = new Date().toISOString();
  request.decidedBy = actor;
  request.decisionReason = reason?.trim() || undefined;

  // Effets internes selon le type de demande (aucune action externe réelle).
  if (request.relatedSupplierOrderId) {
    const so = db.supplierOrders.find(
      (o) => o.id === request.relatedSupplierOrderId,
    );
    if (so) {
      so.status = approved ? "validee" : "annulee";
      if (approved) {
        so.validatedAt = new Date().toISOString();
        so.validatedBy = actor;
        // Date d'arrivée estimée : valeur ajustée par le responsable,
        // sinon celle déjà connue, sinon calculée depuis le délai habituel
        // du fournisseur à partir de la date de validation.
        if (options?.expectedAt) {
          so.expectedAt = options.expectedAt;
        } else if (!so.expectedAt) {
          const supplier = db.suppliers.find((s) => s.id === so.supplierId);
          if (supplier?.leadTimeDays) {
            const d = new Date();
            d.setDate(d.getDate() + supplier.leadTimeDays);
            so.expectedAt = d.toISOString();
          }
        }
        for (const sol of so.lines) {
          const line = db.orderLines.find((l) => l.id === sol.orderLineId);
          if (line && so.expectedAt && !line.expectedArrival) {
            line.expectedArrival = so.expectedAt;
          }
        }
      }
      for (const sol of so.lines) {
        const line = db.orderLines.find((l) => l.id === sol.orderLineId);
        if (line) {
          line.procurementStatus = approved ? "commande" : "a_commander";
          if (!approved) line.supplierOrderId = undefined;
        }
      }
    }
  }

  if (request.type === "annulation_commande" && request.relatedOrderId) {
    const order = db.orders.find((o) => o.id === request.relatedOrderId);
    if (order && approved) {
      order.status = "annulee";
      order.deliveryStatus = "annulee";
      for (const line of db.orderLines.filter((l) => l.orderId === order.id)) {
        line.procurementStatus = "annule";
      }
      // Les règlements existants sont CONSERVÉS. Si un montant a été
      // encaissé, une alerte financière dérivée apparaît (refundAlerts) :
      // « Remboursement ou avoir à traiter ». Aucun remboursement réel.
      const paid = fromCents(orderPaidCents(order, db.payments));
      if (paid > 0) {
        logActivity(db, {
          actor: "TRUST AI",
          action: "Alerte financière",
          details: `Remboursement ou avoir à traiter : ${paid.toLocaleString("fr-FR")} € (commande ${order.reference} annulée après encaissement).`,
          orderId: order.id,
        });
      }
    }
  }

  logActivity(db, {
    actor,
    action: approved ? "Demande validée" : "Demande refusée",
    details: reason ? `${request.title} — motif : ${reason}` : request.title,
    orderId: request.relatedOrderId,
  });
}

// ---------------------------------------------------------------------------
// Commandes fournisseurs
// ---------------------------------------------------------------------------

export function prepareSupplierOrderM(
  db: Database,
  supplierId: string,
  lineIds: string[],
  requestedBy = "TRUST AI",
): string {
  const supplier = db.suppliers.find((s) => s.id === supplierId);
  if (!supplier) throw new BusinessError("Fournisseur introuvable.");
  const lines = db.orderLines.filter((l) => lineIds.includes(l.id));
  if (lines.length === 0) {
    throw new BusinessError("Aucun article à commander chez ce fournisseur.");
  }
  const year = new Date().getFullYear();
  const reference = nextReference(
    db.supplierOrders.map((o) => o.reference),
    `FOU-${year}-`,
  );
  const soId = uid("so");

  db.supplierOrders.push({
    id: soId,
    reference,
    supplierId,
    status: "en_attente_validation",
    lines: lines.map((l) => ({
      id: uid("sol"),
      orderLineId: l.id,
      productName: l.productName,
      variant: l.variant,
      supplierReference: l.reference,
      quantity: l.quantity,
    })),
    createdAt: new Date().toISOString(),
    notes: "Proposition préparée automatiquement — validation humaine obligatoire.",
  });
  for (const l of lines) {
    l.procurementStatus = "en_attente_validation";
    l.supplierOrderId = soId;
  }
  db.approvalRequests.unshift({
    id: uid("apr"),
    type: "commande_fournisseur",
    title: `Valider la commande ${supplier.name} (${reference})`,
    description: `${lines.length} article(s) à commander chez ${supplier.name}. Aucun envoi réel ne sera effectué : la validation met simplement à jour le suivi.`,
    relatedSupplierOrderId: soId,
    relatedOrderId: lines.length === 1 ? lines[0].orderId : undefined,
    requestedBy,
    status: "en_attente",
    createdAt: new Date().toISOString(),
  });
  logActivity(db, {
    actor: requestedBy,
    action: "Proposition de commande fournisseur",
    details: `${reference} (${supplier.name}) — en attente de validation humaine.`,
  });
  return soId;
}

// ---------------------------------------------------------------------------
// Relances du lundi
// ---------------------------------------------------------------------------

/**
 * Marque une relance comme effectuée.
 * - `indisponible` : l'article reste dans la file, prochaine relance
 *   programmée automatiquement le lundi suivant.
 * - `disponible` : l'article SORT de la file des relances, passe en
 *   « En attente de validation » et une proposition de commande
 *   fournisseur est créée automatiquement (validation humaine requise).
 */
export function markReminderDoneM(
  db: Database,
  lineId: string,
  outcome: "indisponible" | "disponible",
  actor = "Équipe achats",
): void {
  const line = db.orderLines.find((l) => l.id === lineId);
  if (!line) throw new BusinessError("Article introuvable.");
  const order = db.orders.find((o) => o.id === line.orderId);
  line.lastReminderAt = new Date().toISOString();

  if (outcome === "indisponible") {
    line.procurementStatus = "indisponible";
    line.nextReminderAt = nextMonday();
    logActivity(db, {
      actor,
      action: "Relance fournisseur effectuée",
      details: `${line.productName} toujours indisponible — prochaine relance programmée lundi prochain.`,
      orderId: order?.id,
    });
    return;
  }

  // Article disponible : sortir des relances et préparer la commande.
  line.nextReminderAt = undefined;
  if (line.supplierId) {
    prepareSupplierOrderM(db, line.supplierId, [line.id], actor);
    logActivity(db, {
      actor,
      action: "Relance fournisseur effectuée",
      details: `${line.productName} de nouveau disponible — proposition de commande fournisseur créée, en attente de validation.`,
      orderId: order?.id,
    });
  } else {
    // Pas de fournisseur identifié : impossible de préparer la proposition.
    line.procurementStatus = "a_verifier";
    logActivity(db, {
      actor,
      action: "Relance fournisseur effectuée",
      details: `${line.productName} disponible mais sans fournisseur attribué — à vérifier avant commande.`,
      orderId: order?.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Réception d'un arrivage (partielle ou totale)
// ---------------------------------------------------------------------------

export function receiveShipmentM(
  db: Database,
  shipmentId: string,
  receipts: { itemId: string; quantityReceived: number }[],
): void {
  const shipment = db.shipments.find((s) => s.id === shipmentId);
  if (!shipment) throw new BusinessError("Arrivage introuvable.");

  for (const receipt of receipts) {
    const item = shipment.items.find((i) => i.id === receipt.itemId);
    if (!item) continue;
    item.quantityReceived = Math.min(
      Math.max(0, Math.round(receipt.quantityReceived)),
      item.quantity,
    );
  }

  const complete = shipment.items.every((i) => i.quantityReceived >= i.quantity);
  const started = shipment.items.some((i) => i.quantityReceived > 0);
  if (complete) {
    shipment.status = "recu";
  } else if (started) {
    shipment.status = "recu_partiellement";
  }
  if (started) shipment.actualAt = new Date().toISOString();

  // Mettre à jour l'étape logistique correspondant à la réception :
  // celle dont la destination est la destination courante du transport.
  // Les étapes suivantes (ex. dépôt → client) ne sont PAS modifiées.
  const receivingLeg = shipment.legs.find(
    (leg) => leg.destinationLabel === shipment.destinationLabel,
  );
  if (receivingLeg && started) {
    receivingLeg.status = complete ? "recu" : "recu_partiellement";
    if (complete) receivingLeg.actualAt = new Date().toISOString();
  }

  // Les lignes de commande entièrement reçues passent en « Reçu au dépôt ».
  for (const item of shipment.items) {
    if (!item.orderLineId) continue;
    const line = db.orderLines.find((l) => l.id === item.orderLineId);
    if (line && item.quantityReceived >= item.quantity) {
      line.procurementStatus = "recu_depot";
    }
  }

  logActivity(db, {
    actor: "Équipe dépôt",
    action: complete ? "Arrivage reçu" : "Réception partielle",
    details: `${shipment.reference} — ${shipment.destinationLabel}.`,
  });
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/**
 * Référentiel logistique d'une variante (mode démonstration). Rejoue les
 * mêmes validations que la fonction serveur `set_variant_logistics` : aucune
 * valeur aberrante n'est acceptée, et aucune correction n'est silencieuse.
 */
export function setVariantLogisticsM(
  db: Database,
  variantId: string,
  logistics: VariantLogistics,
): void {
  const variant = db.productVariants.find((v) => v.id === variantId);
  if (!variant) throw new BusinessError("Variante introuvable.");

  // `null` = effacement volontaire ; `undefined` = champ non transmis, donc
  // valeur conservée. Un nombre décimal est REFUSÉ, jamais arrondi.
  const check = (
    value: number | null | undefined,
    min: number,
    max: number,
    label: string,
  ) => {
    if (value === undefined || value === null) return;
    if (!Number.isFinite(value)) {
      throw new BusinessError(`${label} : valeur numérique attendue.`);
    }
    if (!Number.isInteger(value)) {
      throw new BusinessError(
        `${label} : nombre entier attendu (aucun arrondi automatique).`,
      );
    }
    if (value < min || value > max) {
      throw new BusinessError(
        `${label} : valeur hors limites (attendu entre ${min} et ${max}).`,
      );
    }
  };
  check(logistics.weightGrams, 1, 2_000_000, "Poids (g)");
  check(logistics.packedLengthMm, 1, 10_000, "Longueur emballée (mm)");
  check(logistics.packedWidthMm, 1, 10_000, "Largeur emballée (mm)");
  check(logistics.packedHeightMm, 1, 10_000, "Hauteur emballée (mm)");
  check(logistics.packageCount, 1, 50, "Nombre de colis");
  check(logistics.recommendedHandlers, 1, 4, "Livreurs conseillés");
  check(logistics.volumeCm3, 1, 100_000_000, "Volume (cm³)");

  // Fusion : seules les clés RÉELLEMENT transmises sont appliquées.
  const merged: VariantLogistics = { ...(variant.logistics ?? {}) };
  for (const [key, value] of Object.entries(logistics)) {
    if (value === undefined) continue;
    (merged as Record<string, unknown>)[key] = value === null ? undefined : value;
  }
  // Volume dérivé des dimensions FINALES : recalculé quand les trois sont
  // connues, effacé si l'une d'elles a été vidée (sauf volume explicite).
  if (logistics.volumeCm3 === undefined) {
    merged.volumeCm3 =
      merged.packedLengthMm && merged.packedWidthMm && merged.packedHeightMm
        ? Math.floor(
            (merged.packedLengthMm * merged.packedWidthMm * merged.packedHeightMm) / 1000,
          )
        : undefined;
  }
  merged.verifiedAt = new Date().toISOString();
  variant.logistics = merged;

  logActivity(db, {
    actor: "Équipe logistique",
    action: "Référentiel logistique mis à jour",
    details: `${variant.name} — caractéristiques logistiques enregistrées.`,
  });
}

export function updateLineStatusM(
  db: Database,
  lineId: string,
  status: ProcurementStatus,
  options?: {
    supplierId?: string;
    altSupplierId?: string;
    destinationWarehouseId?: string;
  },
): void {
  const line = db.orderLines.find((l) => l.id === lineId);
  if (!line) throw new BusinessError("Article introuvable.");
  const order = db.orders.find((o) => o.id === line.orderId);
  // Mêmes garde-fous que la fonction serveur set_line_procurement.
  if (order?.status === "annulee") {
    throw new BusinessError(
      "Commande annulée : son suivi ne peut plus être modifié.",
    );
  }
  if (line.procurementStatus === "annule") {
    throw new BusinessError(
      "Article annulé : son suivi ne peut plus être modifié.",
    );
  }
  if (status === "a_commander" && !(options?.supplierId ?? line.supplierId)) {
    throw new BusinessError(
      "Un article à commander doit indiquer son fournisseur principal.",
    );
  }
  line.procurementStatus = status;
  if (options?.supplierId) line.supplierId = options.supplierId;
  if (options?.altSupplierId) line.altSupplierId = options.altSupplierId;
  if (options?.destinationWarehouseId) {
    line.destinationWarehouseId = options.destinationWarehouseId;
  }
  if (status === "relance_due" && !line.nextReminderAt) {
    line.nextReminderAt = nextMonday();
  }
}
