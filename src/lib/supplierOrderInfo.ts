import { fromCents, toCents } from "./money";
import type {
  Customer,
  Database,
  Order,
  Supplier,
  SupplierOrder,
  SupplierOrderLine,
  Warehouse,
} from "./types";

/**
 * Informations métier présentées à l'humain AVANT de valider une commande
 * fournisseur. Règle stricte : aucune valeur n'est inventée — un champ
 * absent des données reste `undefined` et l'interface affiche un
 * avertissement (ex. « Prix d'achat non renseigné »).
 */

export interface SupplierOrderLineInfo {
  line: SupplierOrderLine;
  /** Commande cliente liée (traçabilité), si la ligne en provient. */
  order?: Order;
  customer?: Customer;
  /** Dépôt de destination issu de la ligne de commande cliente. */
  warehouse?: Warehouse;
  /** Prix d'achat unitaire en euros — undefined si non renseigné. */
  unitCost?: number;
  /** Coût d'achat total de la ligne — undefined si prix non renseigné. */
  totalCost?: number;
}

export interface SupplierOrderInfo {
  supplierOrder: SupplierOrder;
  supplier?: Supplier;
  lines: SupplierOrderLineInfo[];
  /** Coût d'achat total — undefined si au moins un prix manque. */
  totalCost?: number;
  /**
   * Date d'arrivée estimée : celle de la commande si elle existe, sinon
   * calculée à partir du délai habituel du fournisseur et de la date de
   * référence fournie (date de validation). `computed` indique qu'elle a
   * été calculée et non saisie.
   */
  estimatedArrival?: string;
  estimatedArrivalComputed: boolean;
}

export function buildSupplierOrderInfo(
  db: Database,
  supplierOrder: SupplierOrder,
  referenceDate: Date = new Date(),
): SupplierOrderInfo {
  const supplier = db.suppliers.find((s) => s.id === supplierOrder.supplierId);

  const lines: SupplierOrderLineInfo[] = supplierOrder.lines.map((line) => {
    const orderLine = line.orderLineId
      ? db.orderLines.find((l) => l.id === line.orderLineId)
      : undefined;
    const order = orderLine
      ? db.orders.find((o) => o.id === orderLine.orderId)
      : undefined;
    const customer = order
      ? db.customers.find((c) => c.id === order.customerId)
      : undefined;
    const warehouse = orderLine?.destinationWarehouseId
      ? db.warehouses.find((w) => w.id === orderLine.destinationWarehouseId)
      : undefined;
    const unitCost = line.unitCost;
    const totalCost =
      unitCost !== undefined
        ? fromCents(Math.round(line.quantity * toCents(unitCost)))
        : undefined;
    return { line, order, customer, warehouse, unitCost, totalCost };
  });

  const allPriced = lines.every((l) => l.totalCost !== undefined);
  const totalCost = allPriced
    ? fromCents(lines.reduce((sum, l) => sum + toCents(l.totalCost ?? 0), 0))
    : undefined;

  let estimatedArrival = supplierOrder.expectedAt;
  let estimatedArrivalComputed = false;
  if (!estimatedArrival && supplier?.leadTimeDays) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + supplier.leadTimeDays);
    estimatedArrival = d.toISOString();
    estimatedArrivalComputed = true;
  }

  return {
    supplierOrder,
    supplier,
    lines,
    totalCost,
    estimatedArrival,
    estimatedArrivalComputed,
  };
}
