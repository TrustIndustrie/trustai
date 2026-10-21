import { beforeEach, describe, expect, it } from "vitest";
import { createSeed, SEED_VERSION } from "./seed";
import {
  BusinessError,
  addPaymentM,
  createStoreOrderM,
  decideApprovalM,
  markReminderDoneM,
  receiveShipmentM,
  requestOrderCancellationM,
  setVariantLogisticsM,
  updateLineStatusM,
} from "./mutations";
import {
  computeReminders,
  globalRap,
  orderPaymentStatus,
  orderRap,
  orderTotal,
  refundAlerts,
} from "./derive";
import { computeMonthSynthesis } from "./cash";
import { buildSupplierOrderInfo } from "./supplierOrderInfo";
import { migrateV2toV3 } from "./repository";
import { addAmounts } from "./money";
import type { Database } from "./types";

let db: Database;

beforeEach(() => {
  db = createSeed();
});

const paymentBase = {
  date: new Date().toISOString(),
  method: "carte_bancaire" as const,
};

describe("Règlements", () => {
  // ord-mag-her-1 : total 1 824 € (1 090 + 774 − 100 + 60), acompte 500 € → RAP 1 324 €
  it("refuse un règlement supérieur au RAP", () => {
    expect(() =>
      addPaymentM(db, "ord-mag-her-1", { ...paymentBase, amount: 1324.01 }),
    ).toThrow(BusinessError);
    // Rien n'a été enregistré (pas de plafonnement silencieux).
    expect(db.payments.filter((p) => p.orderId === "ord-mag-her-1")).toHaveLength(1);
  });

  it("refuse un règlement lorsque le RAP est nul", () => {
    // ord-mag-lis-1 est déjà soldée (400 + 649 = 1 049 = total).
    const order = db.orders.find((o) => o.id === "ord-mag-lis-1")!;
    expect(orderRap(order, db.orderLines, db.payments)).toBe(0);
    expect(() =>
      addPaymentM(db, "ord-mag-lis-1", { ...paymentBase, amount: 10 }),
    ).toThrow(/soldée/);
  });

  it("refuse un règlement nul ou négatif", () => {
    expect(() =>
      addPaymentM(db, "ord-mag-her-1", { ...paymentBase, amount: 0 }),
    ).toThrow(BusinessError);
    expect(() =>
      addPaymentM(db, "ord-mag-her-1", { ...paymentBase, amount: -50 }),
    ).toThrow(BusinessError);
  });

  it("accepte un règlement égal au RAP et solde la commande", () => {
    addPaymentM(db, "ord-mag-her-1", { ...paymentBase, amount: 1324 });
    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(orderRap(order, db.orderLines, db.payments)).toBe(0);
  });

  it("calcule en centimes sans erreur de flottants", () => {
    expect(addAmounts(0.1, 0.2)).toBe(0.3);
  });

  it("calcule le RAP global commande par commande (jamais net d'un trop-perçu)", () => {
    // Trop-perçu artificiel de 10 000 € sur une commande soldée.
    db.payments.push({
      id: "pay-test-overpaid",
      orderId: "ord-mag-lis-1",
      amount: 10000,
      date: new Date().toISOString(),
      method: "virement",
    });
    const before = globalRap(db.orders, db);
    // Le trop-perçu ne doit PAS réduire le RAP des autres commandes :
    // le RAP global reste la somme des RAP positifs.
    const naive =
      before -
      db.orders
        .filter((o) => o.status !== "annulee")
        .reduce((s, o) => s + orderRap(o, db.orderLines, db.payments), 0);
    expect(naive).toBeGreaterThan(0); // le calcul naïf serait bien inférieur
    expect(before).toBeGreaterThan(0);
    const her = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(before).toBeGreaterThanOrEqual(
      orderRap(her, db.orderLines, db.payments),
    );
  });
});

describe("Annulation avec validation humaine", () => {
  it("crée une demande d'annulation sans annuler la commande", () => {
    requestOrderCancellationM(db, "ord-mag-her-1", "Sarah Delcourt");
    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(order.status).toBe("ouverte");
    const request = db.approvalRequests.find(
      (r) => r.type === "annulation_commande" && r.relatedOrderId === "ord-mag-her-1",
    );
    expect(request).toBeDefined();
    expect(request!.status).toBe("en_attente");
    expect(request!.requestedBy).toBe("Sarah Delcourt");
    expect(request!.financialImpact).toBe(500);
  });

  it("empêche deux demandes actives pour la même commande", () => {
    requestOrderCancellationM(db, "ord-mag-her-1");
    expect(() => requestOrderCancellationM(db, "ord-mag-her-1")).toThrow(
      /déjà en attente/,
    );
  });

  it("valide une annulation : commande annulée, règlements conservés, alerte financière", () => {
    requestOrderCancellationM(db, "ord-mag-her-1");
    const request = db.approvalRequests.find(
      (r) => r.type === "annulation_commande" && r.relatedOrderId === "ord-mag-her-1",
    )!;
    const paymentsBefore = db.payments.filter(
      (p) => p.orderId === "ord-mag-her-1",
    ).length;

    decideApprovalM(db, request.id, true, "Julie Mancini", "Client parti à la concurrence");

    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(order.status).toBe("annulee");
    // Les règlements existants ne sont jamais effacés.
    expect(db.payments.filter((p) => p.orderId === "ord-mag-her-1")).toHaveLength(
      paymentsBefore,
    );
    // Alerte financière dérivée : remboursement ou avoir à traiter (500 €).
    const alerts = refundAlerts(db);
    expect(alerts.some((a) => a.order.id === "ord-mag-her-1" && a.amount === 500)).toBe(
      true,
    );
    expect(
      db.activityLog.some(
        (l) =>
          l.action === "Alerte financière" &&
          l.details?.includes("Remboursement ou avoir à traiter"),
      ),
    ).toBe(true);
  });

  it("refuse une annulation : commande intacte, refus et motif dans l'historique", () => {
    requestOrderCancellationM(db, "ord-mag-her-1");
    const request = db.approvalRequests.find(
      (r) => r.type === "annulation_commande" && r.relatedOrderId === "ord-mag-her-1",
    )!;
    decideApprovalM(db, request.id, false, "Julie Mancini", "Client a changé d'avis");

    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(order.status).toBe("ouverte");
    expect(request.status).toBe("refusee");
    expect(request.decisionReason).toBe("Client a changé d'avis");
    expect(
      db.activityLog.some(
        (l) =>
          l.action === "Demande refusée" &&
          l.details?.includes("Client a changé d'avis"),
      ),
    ).toBe(true);
  });

  it("une demande déjà traitée ne peut pas être re-décidée", () => {
    requestOrderCancellationM(db, "ord-mag-her-1");
    const request = db.approvalRequests.find(
      (r) => r.type === "annulation_commande" && r.relatedOrderId === "ord-mag-her-1",
    )!;
    decideApprovalM(db, request.id, false, "Julie Mancini", "Erreur de saisie");
    expect(() => decideApprovalM(db, request.id, true, "X", "motif")).toThrow(
      /déjà été traitée/,
    );
  });

  it("refuse une décision d'annulation sans motif (validation ET refus)", () => {
    requestOrderCancellationM(db, "ord-mag-her-1");
    const request = db.approvalRequests.find(
      (r) => r.type === "annulation_commande" && r.relatedOrderId === "ord-mag-her-1",
    )!;
    expect(() => decideApprovalM(db, request.id, true, "Julie Mancini")).toThrow(
      /motif est obligatoire/,
    );
    expect(() => decideApprovalM(db, request.id, false, "Julie Mancini", "  ")).toThrow(
      /motif est obligatoire/,
    );
    // La demande reste en attente : rien n'a été modifié.
    expect(request.status).toBe("en_attente");
    expect(db.orders.find((o) => o.id === "ord-mag-her-1")!.status).toBe("ouverte");
  });
});

describe("Relances fournisseurs", () => {
  // line-her1-2 : chaises Vera indisponibles, dans la file des relances.
  it("toujours indisponible : reste dans la file, prochain lundi programmé", () => {
    markReminderDoneM(db, "line-her1-2", "indisponible", "Myriam Costa");
    const line = db.orderLines.find((l) => l.id === "line-her1-2")!;
    expect(line.procurementStatus).toBe("indisponible");
    expect(line.nextReminderAt).toBeDefined();
    expect(new Date(line.nextReminderAt!).getDay()).toBe(1); // lundi
    expect(
      computeReminders(db).some((r) => r.line.id === "line-her1-2"),
    ).toBe(true);
    expect(
      db.activityLog.some((l) => l.action === "Relance fournisseur effectuée"),
    ).toBe(true);
  });

  it("article disponible : sort des relances, passe en attente de validation", () => {
    markReminderDoneM(db, "line-her1-2", "disponible", "Myriam Costa");
    const line = db.orderLines.find((l) => l.id === "line-her1-2")!;
    expect(line.procurementStatus).toBe("en_attente_validation");
    expect(line.nextReminderAt).toBeUndefined();
    // Retiré de la file des relances.
    expect(
      computeReminders(db).some((r) => r.line.id === "line-her1-2"),
    ).toBe(false);
  });

  it("article disponible : crée automatiquement une proposition d'achat à valider", () => {
    const soCountBefore = db.supplierOrders.length;
    markReminderDoneM(db, "line-her1-2", "disponible", "Myriam Costa");
    const line = db.orderLines.find((l) => l.id === "line-her1-2")!;
    expect(db.supplierOrders).toHaveLength(soCountBefore + 1);
    const so = db.supplierOrders.find((o) => o.id === line.supplierOrderId)!;
    expect(so.status).toBe("en_attente_validation");
    expect(so.supplierId).toBe("sup-eleonora"); // fournisseur concerné
    expect(so.lines.some((l) => l.orderLineId === "line-her1-2")).toBe(true);
    // Demande de validation humaine associée.
    expect(
      db.approvalRequests.some(
        (r) => r.relatedSupplierOrderId === so.id && r.status === "en_attente",
      ),
    ).toBe(true);
  });
});

describe("Arrivages et étapes logistiques", () => {
  // shp-1 : SM → Argenteuil (reçu) → affrètement → Aubagne (en transit) → client (programmé)
  it("réception partielle : statut global et étape « Reçue partiellement »", () => {
    receiveShipmentM(db, "shp-1", [
      { itemId: "shi-1", quantityReceived: 1 },
      { itemId: "shi-2", quantityReceived: 1 }, // 1 sur 2
    ]);
    const shipment = db.shipments.find((s) => s.id === "shp-1")!;
    expect(shipment.status).toBe("recu_partiellement");
    const receivingLeg = shipment.legs.find((l) => l.id === "leg-1b")!;
    expect(receivingLeg.status).toBe("recu_partiellement");
    // L'étape suivante (Aubagne → client) n'est pas modifiée.
    expect(shipment.legs.find((l) => l.id === "leg-1c")!.status).toBe("programme");
  });

  it("réception complète : transport reçu, étape reçue, étape suivante inchangée", () => {
    receiveShipmentM(db, "shp-1", [
      { itemId: "shi-1", quantityReceived: 1 },
      { itemId: "shi-2", quantityReceived: 2 },
    ]);
    const shipment = db.shipments.find((s) => s.id === "shp-1")!;
    expect(shipment.status).toBe("recu");
    expect(shipment.legs.find((l) => l.id === "leg-1b")!.status).toBe("recu");
    expect(shipment.legs.find((l) => l.id === "leg-1a")!.status).toBe("recu");
    expect(shipment.legs.find((l) => l.id === "leg-1c")!.status).toBe("programme");
    // Les lignes clients concernées passent en « Reçu au dépôt ».
    expect(
      db.orderLines.find((l) => l.id === "line-aub1-1")!.procurementStatus,
    ).toBe("recu_depot");
  });
});

describe("Commande magasin et catalogue", () => {
  const baseOrder = {
    storeId: "store-her",
    salespersonId: "sp-sarah",
    orderedAt: new Date().toISOString(),
    customer: { name: "Client Test", phone: "06 00 00 00 99" },
    fulfillmentMode: "retrait_magasin" as const,
    deliveryFee: 0,
    discount: 0,
    payments: [],
  };

  it("crée une ligne rattachée au catalogue (produit + variante)", () => {
    const order = createStoreOrderM(db, {
      ...baseOrder,
      lines: [
        {
          productId: "prod-vera",
          variantId: "var-vera-taupe",
          offCatalog: false,
          productName: "Chaise Vera",
          variant: "Velours taupe",
          reference: "ELE-VERA-TP",
          quantity: 4,
          unitPrice: 129,
          discount: 0,
          supplierId: "sup-eleonora",
        },
      ],
    });
    const line = db.orderLines.find((l) => l.orderId === order.id)!;
    expect(line.productId).toBe("prod-vera");
    expect(line.variantId).toBe("var-vera-taupe");
    expect(line.offCatalog).toBeUndefined();
    expect(order.reference).toMatch(/^MAG-HER-\d{4}-\d{4}$/);
  });

  it("crée une ligne hors catalogue clairement marquée", () => {
    const order = createStoreOrderM(db, {
      ...baseOrder,
      lines: [
        {
          offCatalog: true,
          productName: "Produit sur mesure",
          quantity: 1,
          unitPrice: 250,
          discount: 0,
        },
      ],
    });
    const line = db.orderLines.find((l) => l.orderId === order.id)!;
    expect(line.offCatalog).toBe(true);
    expect(line.productId).toBeUndefined();
  });

  it("refuse une vendeuse/un vendeur manquant", () => {
    expect(() =>
      createStoreOrderM(db, {
        ...baseOrder,
        salespersonId: "",
        lines: [
          { offCatalog: true, productName: "X", quantity: 1, unitPrice: 10, discount: 0 },
        ],
      }),
    ).toThrow(/obligatoire/);
  });

  it("refuse des règlements initiaux dépassant le total", () => {
    expect(() =>
      createStoreOrderM(db, {
        ...baseOrder,
        payments: [{ amount: 999, date: new Date().toISOString(), method: "especes" }],
        lines: [
          { offCatalog: true, productName: "X", quantity: 1, unitPrice: 10, discount: 0 },
        ],
      }),
    ).toThrow(/dépasse le total/);
  });
});

describe("Référentiel magasins / dépôts", () => {
  it("sépare strictement Herblay (magasin) et Argenteuil (dépôt)", () => {
    // Herblay est un magasin, jamais un dépôt.
    expect(db.stores.some((s) => s.city === "Herblay")).toBe(true);
    expect(db.warehouses.some((w) => w.city === "Herblay")).toBe(false);
    // Argenteuil est un dépôt, jamais un magasin.
    expect(db.warehouses.some((w) => w.city === "Argenteuil")).toBe(true);
    expect(db.stores.some((s) => s.city === "Argenteuil")).toBe(false);
    // Le rattachement logistique existe sans fusion des entités.
    const arg = db.warehouses.find((w) => w.id === "wh-arg")!;
    expect(arg.linkedStoreIds).toContain("store-her");
    expect(arg.id).not.toBe("store-her");
  });

  it("Aubagne garde son alias historique « Marseille » pour les futurs imports", () => {
    const aubagne = db.stores.find((s) => s.code === "AUB")!;
    expect(aubagne.name).toContain("Aubagne");
    expect(aubagne.aliases).toContain("Marseille");
  });
});

// ---------------------------------------------------------------------------
// V1.2 — correctif financier des commandes annulées
// ---------------------------------------------------------------------------

function cancelOrder(database: Database, orderId: string, motif = "Test V1.2") {
  requestOrderCancellationM(database, orderId);
  const request = database.approvalRequests.find(
    (r) => r.type === "annulation_commande" && r.relatedOrderId === orderId,
  )!;
  decideApprovalM(database, request.id, true, "Julie Mancini", motif);
}

describe("V1.2 — historique financier des commandes annulées", () => {
  it("le total historique reste identique avant et après annulation", () => {
    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    const before = orderTotal(order, db.orderLines);
    expect(before).toBe(1824);
    cancelOrder(db, "ord-mag-her-1");
    // Les lignes sont bien passées en statut « Annulé »…
    expect(
      db.orderLines
        .filter((l) => l.orderId === "ord-mag-her-1")
        .every((l) => l.procurementStatus === "annule"),
    ).toBe(true);
    // …mais restent incluses dans le total historique (remise et frais compris).
    expect(orderTotal(order, db.orderLines)).toBe(before);
  });

  it("le RAP d'une commande annulée vaut 0 et sort du RAP global", () => {
    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    const rapBefore = orderRap(order, db.orderLines, db.payments);
    expect(rapBefore).toBe(1324);
    const globalBefore = globalRap(db.orders, db);
    cancelOrder(db, "ord-mag-her-1");
    expect(orderRap(order, db.orderLines, db.payments)).toBe(0);
    expect(globalRap(db.orders, db)).toBeCloseTo(globalBefore - rapBefore, 2);
  });

  it("statut financier « Remboursement ou avoir à traiter » avec le montant exact", () => {
    cancelOrder(db, "ord-mag-her-1");
    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(orderPaymentStatus(order, db.orderLines, db.payments)).toBe(
      "remboursement_a_traiter",
    );
    const alert = refundAlerts(db).find((a) => a.order.id === "ord-mag-her-1")!;
    expect(alert.amount).toBe(500); // somme exacte des règlements encaissés
  });

  it("commande annulée sans règlement : aucun remboursement nécessaire", () => {
    db.payments = db.payments.filter((p) => p.orderId !== "ord-mag-her-1");
    cancelOrder(db, "ord-mag-her-1");
    const order = db.orders.find((o) => o.id === "ord-mag-her-1")!;
    expect(orderPaymentStatus(order, db.orderLines, db.payments)).toBe("sans_objet");
    expect(refundAlerts(db).some((a) => a.order.id === "ord-mag-her-1")).toBe(false);
  });

  it("un ancien trop-perçu (2 398 € encaissés) reste conservé et à traiter en totalité", () => {
    // Données héritées d'un ancien test : règlement poussé directement,
    // sans passer par la validation métier actuelle.
    db.payments.push({
      id: "pay-legacy-overpaid",
      orderId: "ord-mag-her-1",
      amount: 1898,
      date: new Date().toISOString(),
      method: "virement",
    });
    // 500 + 1 898 = 2 398 € encaissés pour un total de 1 824 €.
    cancelOrder(db, "ord-mag-her-1");
    const alert = refundAlerts(db).find((a) => a.order.id === "ord-mag-her-1")!;
    // Ni corrigé, ni plafonné, ni supprimé : le montant à traiter est 2 398 €.
    expect(alert.amount).toBe(2398);
    expect(db.payments.filter((p) => p.orderId === "ord-mag-her-1")).toHaveLength(2);
  });
});

describe("V1.2 — synthèse des encaissements", () => {
  it("facturé actif exclut les annulées, encaissé brut conserve les règlements reçus", () => {
    const month = new Date().toISOString().slice(0, 7);
    const scope = { storeId: "all", salespersonId: "all" };
    const before = computeMonthSynthesis(db, month, scope);
    // ord-mag-aub-2 : créée aujourd'hui, total 509 €, acompte 250 € aujourd'hui.
    cancelOrder(db, "ord-mag-aub-2");
    const after = computeMonthSynthesis(db, month, scope);
    // Le facturé actif diminue du total historique de la commande annulée…
    expect(after.totals.invoicedCents).toBe(before.totals.invoicedCents - 50900);
    // …mais l'encaissé brut conserve les paiements réellement reçus.
    expect(after.totals.collectedCents).toBe(before.totals.collectedCents);
    // Le montant encaissé passe en « remboursements / avoirs à traiter ».
    expect(after.totals.toTreatCents).toBe(before.totals.toTreatCents + 25000);
    // Aucune opération réelle n'a été enregistrée : « effectués » inchangé.
    expect(after.totals.refundDoneCents).toBe(before.totals.refundDoneCents);
    // Le RAP actif ne compte plus la commande annulée.
    expect(after.totals.rapCents).toBe(before.totals.rapCents - 25900);
  });
});

describe("V1.2 — informations de validation d'une commande fournisseur", () => {
  it("affiche les informations disponibles sans inventer les manquantes", () => {
    const so = db.supplierOrders.find((s) => s.id === "so-1")!;
    const info = buildSupplierOrderInfo(db, so);
    expect(info.supplier?.name).toBe("GDM");
    const line = info.lines[0];
    // Aucun prix d'achat dans les données → rien n'est inventé.
    expect(line.unitCost).toBeUndefined();
    expect(line.totalCost).toBeUndefined();
    expect(info.totalCost).toBeUndefined();
    // Traçabilité complète vers la commande cliente.
    expect(line.order?.reference).toBe("MAG-HER-2026-0007");
    expect(line.customer?.name).toBe("Camille Estève");
    // Dépôt de destination : Argenteuil (dépôt), jamais Herblay (magasin).
    expect(line.warehouse?.id).toBe("wh-arg");
    expect(line.warehouse?.city).toBe("Argenteuil");
    // Date estimée existante : reprise telle quelle, pas recalculée.
    expect(info.estimatedArrival).toBe(so.expectedAt);
    expect(info.estimatedArrivalComputed).toBe(false);
  });

  it("calcule la date estimée depuis le délai habituel uniquement si elle est absente", () => {
    const so = db.supplierOrders.find((s) => s.id === "so-1")!;
    so.expectedAt = undefined;
    const info = buildSupplierOrderInfo(db, so, new Date("2026-08-12T10:00:00"));
    // GDM : délai habituel de 7 jours → 19/08/2026.
    expect(info.estimatedArrivalComputed).toBe(true);
    expect(info.estimatedArrival!.slice(0, 10)).toBe("2026-08-19");
  });

  it("la validation applique la date d'arrivée ajustée par le responsable", () => {
    decideApprovalM(db, "apr-1", true, "Myriam Costa", undefined, {
      expectedAt: "2026-09-01T12:00:00.000Z",
    });
    const so = db.supplierOrders.find((s) => s.id === "so-1")!;
    expect(so.status).toBe("validee");
    expect(so.expectedAt).toBe("2026-09-01T12:00:00.000Z");
  });
});

describe("V1.2 — carte Relances du tableau de bord", () => {
  it("distingue les relances dues des relances programmées", () => {
    const before = computeReminders(db);
    const dueBefore = before.filter((r) => r.due).length;
    expect(dueBefore).toBeGreaterThan(0);
    // « Toujours indisponible » programme le lundi suivant → sort des dues,
    // entre dans les programmées.
    markReminderDoneM(db, "line-her1-2", "indisponible");
    const after = computeReminders(db);
    const item = after.find((r) => r.line.id === "line-her1-2")!;
    expect(item.due).toBe(false);
    expect(after.filter((r) => r.due)).toHaveLength(dueBefore - 1);
    expect(after.filter((r) => !r.due).length).toBeGreaterThan(0);
  });
});

describe("V1.2 — migration v2 → v3", () => {
  it("préserve toutes les données v2 (dont annulations de test) et reste idempotente", () => {
    const v2 = createSeed();
    v2.version = 2;
    // Données créées pendant les tests v2 : commande annulée avec règlements.
    v2.orders.push({
      id: "ord-user-test",
      reference: "MAG-LIS-2026-0042",
      origin: "MAGASIN",
      storeId: "store-lis",
      salespersonId: "sp-nadia",
      customerId: "cus-3",
      orderedAt: new Date().toISOString(),
      fulfillmentMode: "retrait_magasin",
      deliveryStatus: "annulee",
      deliveryFee: 199,
      discount: 0,
      status: "annulee",
      createdAt: new Date().toISOString(),
    });
    v2.orderLines.push({
      id: "line-user-test",
      orderId: "ord-user-test",
      productName: "Canapé test",
      quantity: 1,
      unitPrice: 1999,
      discount: 0,
      procurementStatus: "annule",
    });
    v2.payments.push({
      id: "pay-user-test",
      orderId: "ord-user-test",
      amount: 2398,
      date: new Date().toISOString(),
      method: "carte_bancaire",
    });

    const v3 = migrateV2toV3(v2);
    expect(v3.version).toBe(SEED_VERSION);
    // Tout est conservé, sans doublon.
    expect(v3.orders).toHaveLength(v2.orders.length);
    expect(v3.payments).toHaveLength(v2.payments.length);
    expect(v3.orders.some((o) => o.id === "ord-user-test")).toBe(true);
    // Le total historique de la commande annulée est de nouveau correct
    // (1 999 + 199 de frais), dérivé des lignes existantes.
    const order = v3.orders.find((o) => o.id === "ord-user-test")!;
    expect(orderTotal(order, v3.orderLines)).toBe(2198);
    // Le trop-perçu historique reste à traiter en totalité.
    expect(refundAlerts(v3).find((a) => a.order.id === "ord-user-test")!.amount).toBe(2398);
    // Idempotence : re-migrer ne change rien.
    const again = migrateV2toV3(v3);
    expect(again.orders).toHaveLength(v3.orders.length);
    expect(again.payments).toHaveLength(v3.payments.length);
    expect(again.activityLog).toHaveLength(v3.activityLog.length);
  });
});

describe("V2 — auto-validation interdite", () => {
  it("le demandeur d'une annulation ne peut pas la valider lui-même", () => {
    requestOrderCancellationM(db, "ord-mag-her-1", "Julie Mancini");
    const request = db.approvalRequests.find(
      (r) => r.type === "annulation_commande" && r.relatedOrderId === "ord-mag-her-1",
    )!;
    expect(() =>
      decideApprovalM(db, request.id, true, "Julie Mancini", "Motif"),
    ).toThrow(/propre demande/);
    // Une autre personne peut décider normalement.
    decideApprovalM(db, request.id, false, "Direction Trust", "Refus test");
    expect(request.status).toBe("refusee");
  });
});

describe("Qualification d'une ligne (updateLineStatusM)", () => {
  it("exige un fournisseur pour passer « à commander »", () => {
    // Cas d'une commande Shopify fraîchement reçue : article non encore
    // rattaché à un fournisseur.
    const line = db.orderLines.find((l) => l.procurementStatus !== "annule");
    if (!line) throw new Error("Jeu de données inattendu : aucune ligne active.");
    line.supplierId = undefined;
    line.procurementStatus = "a_verifier";
    const before = line.procurementStatus;
    expect(() => updateLineStatusM(db, line.id, "a_commander")).toThrow(BusinessError);
    // Refus atomique : rien n'a changé.
    expect(line.procurementStatus).toBe(before);

    const supplierId = db.suppliers[0].id;
    updateLineStatusM(db, line.id, "a_commander", { supplierId });
    expect(line.procurementStatus).toBe("a_commander");
    expect(line.supplierId).toBe(supplierId);
  });

  it("refuse toute modification sur une commande annulée", () => {
    const order = db.orders.find((o) => o.status === "ouverte");
    if (!order) throw new Error("Jeu de données inattendu : aucune commande ouverte.");
    const line = db.orderLines.find((l) => l.orderId === order.id);
    if (!line) throw new Error("Jeu de données inattendu : commande sans ligne.");
    order.status = "annulee";
    expect(() => updateLineStatusM(db, line.id, "stock_local")).toThrow(BusinessError);
  });

  it("refuse de modifier une ligne déjà annulée", () => {
    const line = db.orderLines[0];
    line.procurementStatus = "annule";
    expect(() => updateLineStatusM(db, line.id, "stock_local")).toThrow(BusinessError);
  });
});

describe("Référentiel logistique (setVariantLogisticsM)", () => {
  it("refuse les valeurs aberrantes sans rien enregistrer", () => {
    const variant = db.productVariants[0];
    expect(() =>
      setVariantLogisticsM(db, variant.id, { recommendedHandlers: 9 }),
    ).toThrow(BusinessError);
    expect(() => setVariantLogisticsM(db, variant.id, { weightGrams: -5 })).toThrow(
      BusinessError,
    );
    expect(() => setVariantLogisticsM(db, variant.id, { packageCount: 0 })).toThrow(
      BusinessError,
    );
    expect(variant.logistics).toBeUndefined();
  });

  it("calcule le volume dès que les trois dimensions emballées sont connues", () => {
    const variant = db.productVariants[0];
    setVariantLogisticsM(db, variant.id, {
      weightGrams: 45000,
      packedLengthMm: 2500,
      packedWidthMm: 1000,
      packedHeightMm: 800,
      packageCount: 2,
      recommendedHandlers: 2,
      fragile: true,
    });
    expect(variant.logistics?.volumeCm3).toBe((2500 * 1000 * 800) / 1000);
    expect(variant.logistics?.weightGrams).toBe(45000);
    expect(variant.logistics?.fragile).toBe(true);
    expect(variant.logistics?.verifiedAt).toBeTruthy();
  });

  it("conserve les valeurs déjà saisies lors d'une mise à jour partielle", () => {
    const variant = db.productVariants[0];
    setVariantLogisticsM(db, variant.id, { weightGrams: 30000, packageCount: 3 });
    setVariantLogisticsM(db, variant.id, { fragile: true });
    expect(variant.logistics?.weightGrams).toBe(30000);
    expect(variant.logistics?.packageCount).toBe(3);
    expect(variant.logistics?.fragile).toBe(true);
  });

  it("refuse une variante inconnue", () => {
    expect(() => setVariantLogisticsM(db, "inexistante", { weightGrams: 1 })).toThrow(
      BusinessError,
    );
  });

  it("efface une caractéristique avec null, conserve les champs non transmis", () => {
    const variant = db.productVariants[0];
    setVariantLogisticsM(db, variant.id, { weightGrams: 45000, packageCount: 3 });
    expect(variant.logistics?.weightGrams).toBe(45000);

    // null = effacement volontaire ; les autres champs restent intacts.
    setVariantLogisticsM(db, variant.id, { weightGrams: null });
    expect(variant.logistics?.weightGrams).toBeUndefined();
    expect(variant.logistics?.packageCount).toBe(3);
  });

  it("refuse les nombres décimaux au lieu de les arrondir", () => {
    const variant = db.productVariants[0];
    expect(() => setVariantLogisticsM(db, variant.id, { weightGrams: 45.7 })).toThrow(
      /entier attendu/,
    );
    expect(() =>
      setVariantLogisticsM(db, variant.id, { recommendedHandlers: 2.5 }),
    ).toThrow(/entier attendu/);
    // Aucun enregistrement partiel après un refus.
    expect(variant.logistics).toBeUndefined();
  });

  it("efface le volume dérivé quand une dimension est vidée", () => {
    const variant = db.productVariants[0];
    setVariantLogisticsM(db, variant.id, {
      packedLengthMm: 2000,
      packedWidthMm: 1000,
      packedHeightMm: 500,
    });
    expect(variant.logistics?.volumeCm3).toBe((2000 * 1000 * 500) / 1000);
    setVariantLogisticsM(db, variant.id, { packedHeightMm: null });
    expect(variant.logistics?.volumeCm3).toBeUndefined();
  });
});
