"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { formatDate, formatEuro } from "@/lib/format";
import { supplierChannelLabels } from "@/lib/labels";
import type { SupplierOrderInfo } from "@/lib/supplierOrderInfo";

/**
 * Détail métier d'une commande fournisseur présenté AVANT validation
 * humaine. Aucune valeur n'est inventée : les champs absents affichent un
 * avertissement explicite (ex. « Prix d'achat non renseigné »).
 */
export function SupplierOrderInfoTable({ info }: { info: SupplierOrderInfo }) {
  const { supplier } = info;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
        <table className="table-base">
          <thead>
            <tr>
              <th scope="col">Produit / variante</th>
              <th scope="col">Qté</th>
              <th scope="col">SKU / réf. fournisseur</th>
              <th scope="col">Prix d&apos;achat unitaire</th>
              <th scope="col">Coût d&apos;achat total</th>
              <th scope="col">Commande cliente</th>
              <th scope="col">Client</th>
              <th scope="col">Dépôt de destination</th>
            </tr>
          </thead>
          <tbody>
            {info.lines.map(({ line, order, customer, warehouse, unitCost, totalCost }) => (
              <tr key={line.id}>
                <td>
                  <p className="font-medium">{line.productName}</p>
                  {line.variant ? (
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {line.variant}
                    </p>
                  ) : null}
                </td>
                <td>{line.quantity}</td>
                <td>{line.supplierReference ?? "—"}</td>
                <td className="whitespace-nowrap">
                  {unitCost !== undefined ? (
                    formatEuro(unitCost)
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium"
                      style={{ color: "var(--warning)" }}
                    >
                      <AlertTriangle size={13} aria-hidden />
                      Prix d&apos;achat non renseigné
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  {totalCost !== undefined ? formatEuro(totalCost) : "—"}
                </td>
                <td>
                  {order ? (
                    <Link
                      href={`/commandes/${order.id}`}
                      className="font-medium"
                      style={{ color: "var(--primary)" }}
                    >
                      {order.reference}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{customer?.name ?? "—"}</td>
                <td>{warehouse?.name ?? "À déterminer"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl
        className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4"
        style={{ color: "var(--muted)" }}
      >
        <div className="flex gap-1.5">
          <dt>Fournisseur :</dt>
          <dd className="font-medium" style={{ color: "var(--foreground)" }}>
            {supplier?.name ?? "—"}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Canal de commande :</dt>
          <dd>{supplier ? supplierChannelLabels[supplier.orderChannel] : "—"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Délai habituel :</dt>
          <dd>{supplier?.leadTimeDays ? `${supplier.leadTimeDays} jours` : "Non renseigné"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Arrivée estimée :</dt>
          <dd>
            {info.estimatedArrival
              ? `${formatDate(info.estimatedArrival)}${info.estimatedArrivalComputed ? " (calculée depuis le délai habituel)" : ""}`
              : "Non renseignée"}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Coût d&apos;achat total :</dt>
          <dd>
            {info.totalCost !== undefined
              ? formatEuro(info.totalCost)
              : "Incomplet — prix d'achat manquant(s)"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
