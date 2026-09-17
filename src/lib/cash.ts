import { linesOfOrder, orderPaidCents, orderRapCents, orderTotalCents } from "./derive";
import { toCents } from "./money";
import type { Database, Order, Payment, PaymentMethod } from "./types";

/**
 * Synthèse financière des encaissements. Sémantique des indicateurs :
 *
 * - « Facturé actif » : total des commandes NON ANNULÉES créées dans la
 *   période (l'historique des commandes annulées reste consultable sur
 *   leurs fiches, mais ne compte pas comme du facturé actif) ;
 * - « Encaissé brut » : TOUS les règlements réellement reçus dans la
 *   période, y compris ceux de commandes annulées ensuite ;
 * - « Remboursements / avoirs effectués » : uniquement les opérations
 *   réellement enregistrées (règlements négatifs) — jamais les alertes ;
 * - « Remboursements / avoirs à traiter » : règlements encaissés sur des
 *   commandes aujourd'hui annulées et non encore traités ;
 * - « RAP actif » : reste à payer des commandes non annulées uniquement,
 *   calculé commande par commande.
 */

export const FINANCING_METHODS: PaymentMethod[] = [
  "cofidis",
  "pnf",
  "alma",
  "floa",
  "paiement_express",
];

export interface CashScope {
  /** "all" ou id de magasin. */
  storeId: string;
  /** "all" ou id de vendeuse/vendeur. */
  salespersonId: string;
}

export interface DayRow {
  day: string;
  invoicedCents: number;
  collectedCents: number;
  cashCents: number;
  cardCents: number;
  transferCents: number;
  financingCents: number;
  creditCents: number;
  refundDoneCents: number;
  toTreatCents: number;
  rapCents: number;
}

export interface MonthSynthesis {
  rows: DayRow[];
  totals: {
    invoicedCents: number;
    collectedCents: number;
    rapCents: number;
    refundDoneCents: number;
    toTreatCents: number;
  };
}

/** Commandes actives (non annulées) du périmètre. */
export function scopedActiveOrders(db: Database, scope: CashScope): Order[] {
  return db.orders.filter(
    (o) =>
      o.status !== "annulee" &&
      (scope.storeId === "all" || o.storeId === scope.storeId) &&
      (scope.salespersonId === "all" || o.salespersonId === scope.salespersonId),
  );
}

/** Règlements du périmètre (toutes commandes, y compris annulées). */
export function scopedPayments(db: Database, scope: CashScope): Payment[] {
  return db.payments.filter(
    (p) =>
      (scope.storeId === "all" ? true : p.storeId === scope.storeId) &&
      (scope.salespersonId === "all" || p.salespersonId === scope.salespersonId),
  );
}

/**
 * Un règlement « à traiter » : règlement positif d'une commande
 * actuellement annulée dont l'encaissement net n'a pas encore été
 * remboursé/transformé en avoir.
 */
function isToTreat(db: Database, payment: Payment): boolean {
  if (payment.amount <= 0) return false;
  const order = db.orders.find((o) => o.id === payment.orderId);
  if (!order || order.status !== "annulee") return false;
  return orderPaidCents(order, db.payments) > 0;
}

/** Synthèse mensuelle : une ligne par journée ayant de l'activité. */
export function computeMonthSynthesis(
  db: Database,
  month: string,
  scope: CashScope,
): MonthSynthesis {
  const rows = new Map<string, DayRow>();
  const rowFor = (day: string): DayRow => {
    let row = rows.get(day);
    if (!row) {
      row = {
        day,
        invoicedCents: 0,
        collectedCents: 0,
        cashCents: 0,
        cardCents: 0,
        transferCents: 0,
        financingCents: 0,
        creditCents: 0,
        refundDoneCents: 0,
        toTreatCents: 0,
        rapCents: 0,
      };
      rows.set(day, row);
    }
    return row;
  };

  for (const order of scopedActiveOrders(db, scope)) {
    const day = order.orderedAt.slice(0, 10);
    if (!day.startsWith(month)) continue;
    const row = rowFor(day);
    row.invoicedCents += orderTotalCents(order, linesOfOrder(db, order.id));
    // RAP actif des commandes créées ce jour-là, commande par commande.
    row.rapCents += Math.max(0, orderRapCents(order, db.orderLines, db.payments));
  }

  for (const payment of scopedPayments(db, scope)) {
    const day = payment.date.slice(0, 10);
    if (!day.startsWith(month)) continue;
    const row = rowFor(day);
    const cents = toCents(payment.amount);
    row.collectedCents += cents;
    if (isToTreat(db, payment)) row.toTreatCents += cents;
    if (cents < 0) {
      row.refundDoneCents += cents;
    } else if (payment.method === "especes") {
      row.cashCents += cents;
    } else if (payment.method === "carte_bancaire") {
      row.cardCents += cents;
    } else if (payment.method === "virement") {
      row.transferCents += cents;
    } else if (FINANCING_METHODS.includes(payment.method)) {
      row.financingCents += cents;
    } else if (payment.method === "avoir") {
      row.creditCents += cents;
    }
  }

  const sorted = Array.from(rows.values()).sort((a, b) =>
    b.day.localeCompare(a.day),
  );
  const totals = sorted.reduce(
    (acc, r) => ({
      invoicedCents: acc.invoicedCents + r.invoicedCents,
      collectedCents: acc.collectedCents + r.collectedCents,
      rapCents: acc.rapCents + r.rapCents,
      refundDoneCents: acc.refundDoneCents + r.refundDoneCents,
      toTreatCents: acc.toTreatCents + r.toTreatCents,
    }),
    {
      invoicedCents: 0,
      collectedCents: 0,
      rapCents: 0,
      refundDoneCents: 0,
      toTreatCents: 0,
    },
  );
  return { rows: sorted, totals };
}
