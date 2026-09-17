import { fromCents, toCents } from "./money";
import type {
  Database,
  Order,
  OrderLine,
  Payment,
  PaymentStatus,
  ProcurementStatus,
} from "./types";

/**
 * Valeurs dérivées : totaux, RAP, statuts de paiement, file des relances.
 * Tous les calculs monétaires passent par des centimes entiers (money.ts).
 * Ces valeurs ne sont JAMAIS stockées : elles sont recalculées à la volée.
 */

/** Total d'une ligne en centimes : quantité × prix unitaire − remise. */
export function lineTotalCents(line: OrderLine): number {
  return (
    Math.round(line.quantity * toCents(line.unitPrice)) -
    toCents(line.discount || 0)
  );
}

/** Total d'une ligne en euros. */
export function lineTotal(line: OrderLine): number {
  return fromCents(lineTotalCents(line));
}

/**
 * Total HISTORIQUE d'une commande en centimes.
 *
 * Règle métier : une annulation modifie les statuts, jamais l'historique
 * financier. Le total est donc calculé à partir de TOUTES les lignes
 * initiales — y compris celles passées en statut « Annulé » — avec les
 * remises et frais de livraison d'origine. Une commande de 450 € annulée
 * affiche toujours 450 €, jamais 0 €.
 */
export function orderTotalCents(order: Order, lines: OrderLine[]): number {
  const items = lines
    .filter((l) => l.orderId === order.id)
    .reduce((sum, l) => sum + lineTotalCents(l), 0);
  return items - toCents(order.discount || 0) + toCents(order.deliveryFee || 0);
}

/** Total historique d'une commande : somme des lignes − remise globale + frais de livraison. */
export function orderTotal(order: Order, lines: OrderLine[]): number {
  return fromCents(orderTotalCents(order, lines));
}

/** Total encaissé en centimes (les remboursements sont négatifs). */
export function orderPaidCents(order: Order, payments: Payment[]): number {
  return payments
    .filter((p) => p.orderId === order.id)
    .reduce((sum, p) => sum + toCents(p.amount), 0);
}

/** Total encaissé en euros. */
export function orderPaid(order: Order, payments: Payment[]): number {
  return fromCents(orderPaidCents(order, payments));
}

/**
 * RAP en centimes = total de la commande − règlements encaissés.
 * Une commande annulée n'a plus rien à payer : son RAP vaut toujours 0
 * (le montant encaissé devient un remboursement/avoir à traiter, jamais
 * un reste à payer).
 */
export function orderRapCents(
  order: Order,
  lines: OrderLine[],
  payments: Payment[],
): number {
  if (order.status === "annulee") return 0;
  return orderTotalCents(order, lines) - orderPaidCents(order, payments);
}

/** RAP = reste à payer = total de la commande − total des règlements encaissés. */
export function orderRap(
  order: Order,
  lines: OrderLine[],
  payments: Payment[],
): number {
  return fromCents(orderRapCents(order, lines, payments));
}

/**
 * RAP global d'un ensemble de commandes, calculé COMMANDE PAR COMMANDE :
 * somme de max(total commande − règlements de cette commande, 0).
 * Un trop-perçu éventuel sur une commande ne diminue jamais le RAP
 * d'une autre commande.
 */
export function globalRap(orders: Order[], db: Database): number {
  const cents = orders
    .filter((o) => o.status !== "annulee")
    .reduce(
      (sum, o) =>
        sum + Math.max(0, orderRapCents(o, db.orderLines, db.payments)),
      0,
    );
  return fromCents(cents);
}

/**
 * Statut financier, toujours calculé à partir du total et des règlements.
 * Une commande annulée ne porte jamais le badge « Payé » : elle affiche
 * « Remboursement ou avoir à traiter » (si un règlement existe) ou
 * « Aucun remboursement nécessaire ».
 */
export function orderPaymentStatus(
  order: Order,
  lines: OrderLine[],
  payments: Payment[],
): PaymentStatus {
  const total = orderTotalCents(order, lines);
  const paid = orderPaidCents(order, payments);
  if (order.status === "annulee") {
    return paid > 0 ? "remboursement_a_traiter" : "sans_objet";
  }
  if (paid <= 0) return "a_payer";
  if (paid >= total) return "paye";
  return "partiellement_paye";
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Statuts d'approvisionnement qui alimentent la file des relances du lundi. */
export const REMINDER_STATUSES: ProcurementStatus[] = [
  "a_commander",
  "indisponible",
  "relance_due",
];

export interface ReminderItem {
  line: OrderLine;
  order: Order;
  overdueDays: number;
  /** true si la relance est due (date atteinte ou dépassée, ou sans date). */
  due: boolean;
}

/** File des relances du lundi, calculée depuis les lignes de commande. */
export function computeReminders(db: Database): ReminderItem[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items: ReminderItem[] = [];
  for (const line of db.orderLines) {
    if (!REMINDER_STATUSES.includes(line.procurementStatus)) continue;
    const order = db.orders.find((o) => o.id === line.orderId);
    if (!order || order.status === "annulee") continue;
    let overdueDays = 0;
    let due = true;
    if (line.nextReminderAt) {
      const next = new Date(line.nextReminderAt);
      next.setHours(0, 0, 0, 0);
      overdueDays = Math.floor(
        (today.getTime() - next.getTime()) / (1000 * 60 * 60 * 24),
      );
      due = overdueDays >= 0;
    }
    items.push({ line, order, overdueDays, due });
  }
  return items.sort((a, b) => b.overdueDays - a.overdueDays);
}

/**
 * Avancement logistique d'une commande : part des lignes déjà disponibles
 * (stock local) ou reçues au dépôt, hors lignes annulées.
 */
export function orderProgress(order: Order, lines: OrderLine[]): number {
  const active = lines.filter(
    (l) => l.orderId === order.id && l.procurementStatus !== "annule",
  );
  if (active.length === 0) return 0;
  const done = active.filter((l) =>
    ["stock_local", "recu_depot"].includes(l.procurementStatus),
  ).length;
  return Math.round((done / active.length) * 100);
}

export function linesOfOrder(db: Database, orderId: string): OrderLine[] {
  return db.orderLines.filter((l) => l.orderId === orderId);
}

/**
 * Alertes financières dérivées : commandes annulées pour lesquelles un
 * montant a été encaissé → remboursement ou avoir à traiter.
 * Dérivé (jamais stocké) : l'alerte disparaîtra d'elle-même quand un
 * remboursement (règlement négatif) ramènera l'encaissé à zéro.
 */
export interface FinancialAlert {
  order: Order;
  amount: number;
}

export function refundAlerts(db: Database): FinancialAlert[] {
  return db.orders
    .filter((o) => o.status === "annulee")
    .map((o) => ({ order: o, amount: fromCents(orderPaidCents(o, db.payments)) }))
    .filter((a) => a.amount > 0);
}

/** Demande d'annulation active (en attente) pour une commande. */
export function pendingCancellation(db: Database, orderId: string) {
  return db.approvalRequests.find(
    (r) =>
      r.type === "annulation_commande" &&
      r.relatedOrderId === orderId &&
      r.status === "en_attente",
  );
}
