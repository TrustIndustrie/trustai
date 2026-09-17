"use client";

import { useState } from "react";
import { PackageOpen, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useData, BusinessError } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { formatDate } from "@/lib/format";
import { shipmentStatusLabels, transportModeLabels } from "@/lib/labels";
import type { Shipment } from "@/lib/types";

type ViewKey =
  | "en_retard"
  | "a_venir"
  | "en_transit"
  | "recus_partiellement"
  | "recus"
  | "archives"
  | "tous";

function shipmentView(shipment: Shipment): ViewKey {
  if (shipment.status === "annule") return "archives";
  if (shipment.status === "recu") return "recus";
  if (shipment.status === "recu_partiellement") return "recus_partiellement";
  if (shipment.status === "en_transit") return "en_transit";
  const late =
    shipment.status === "retarde" ||
    (shipment.plannedAt !== undefined &&
      new Date(shipment.plannedAt).getTime() < Date.now());
  return late ? "en_retard" : "a_venir";
}

export default function ShipmentsPage() {
  const { db, receiveShipment } = useData();
  const { notify } = useToast();
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [view, setView] = useState<ViewKey>("tous");
  const [receiving, setReceiving] = useState<Shipment | null>(null);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({});

  if (!db) return <LoadingState />;

  const byWarehouse = db.shipments.filter(
    (s) => warehouseFilter === "all" || s.warehouseId === warehouseFilter,
  );
  const countFor = (v: ViewKey) =>
    byWarehouse.filter((s) => shipmentView(s) === v).length;
  const shipments = byWarehouse
    .filter((s) => view === "tous" || shipmentView(s) === view)
    .sort((a, b) => (a.plannedAt ?? "").localeCompare(b.plannedAt ?? ""));

  const openReception = (shipment: Shipment) => {
    setReceiving(shipment);
    setReceivedQuantities(
      Object.fromEntries(
        shipment.items.map((i) => [i.id, String(i.quantityReceived)]),
      ),
    );
  };

  const submitReception = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiving) return;
    try {
      await receiveShipment(
        receiving.id,
        receiving.items.map((i) => ({
          itemId: i.id,
          quantityReceived: parseInt(receivedQuantities[i.id] ?? "0", 10) || 0,
        })),
      );
      notify("Réception enregistrée.");
    } catch (err) {
      notify(
        err instanceof BusinessError
          ? err.message
          : "Impossible d'enregistrer la réception.",
        "error",
      );
    }
    setReceiving(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Arrivages et transports</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Mouvements fournisseurs, mouvements entre dépôts et affrètements.
          Les réceptions peuvent être partielles.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ViewTabs<ViewKey>
          ariaLabel="Filtrer les arrivages"
          value={view}
          onChange={setView}
          tabs={[
            { key: "en_retard", label: "En retard", count: countFor("en_retard") },
            { key: "a_venir", label: "À venir", count: countFor("a_venir") },
            { key: "en_transit", label: "En transit", count: countFor("en_transit") },
            {
              key: "recus_partiellement",
              label: "Reçus partiellement",
              count: countFor("recus_partiellement"),
            },
            { key: "recus", label: "Reçus", count: countFor("recus") },
            { key: "archives", label: "Archives", count: countFor("archives") },
            { key: "tous", label: "Tous" },
          ]}
        />
        <label>
          <span className="sr-only">Dépôt</span>
          <select
            className="field-input w-auto"
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
          >
            <option value="all">Tous les dépôts</option>
            {db.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shipments.length === 0 ? (
        <EmptyState
          title="Aucun arrivage pour ces filtres"
          description="Modifiez le dépôt ou le statut pour voir d'autres mouvements."
          icon={Truck}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {shipments.map((shipment) => {
            const status = shipmentStatusLabels[shipment.status];
            const supplier = db.suppliers.find((s) => s.id === shipment.supplierId);
            const warehouse = db.warehouses.find((w) => w.id === shipment.warehouseId);
            const totalQty = shipment.items.reduce((s, i) => s + i.quantity, 0);
            const receivedQty = shipment.items.reduce((s, i) => s + i.quantityReceived, 0);
            const receivable = !["recu", "annule"].includes(shipment.status);
            return (
              <div key={shipment.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{shipment.reference}</p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="text-sm" style={{ color: "var(--muted)" }}>
                        {transportModeLabels[shipment.mode]}
                        {shipment.charterReference
                          ? ` · Affrètement ${shipment.charterReference}`
                          : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">
                      {shipment.originLabel} → {shipment.destinationLabel}
                    </p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {supplier ? `Fournisseur : ${supplier.name} · ` : ""}
                      {warehouse ? (
                        <span className="inline-flex items-center gap-1">
                          <WarehouseIcon size={13} aria-hidden />
                          {warehouse.name}
                        </span>
                      ) : null}
                      {shipment.carrier ? ` · Transporteur : ${shipment.carrier}` : ""}
                    </p>
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                      Prévu le {formatDate(shipment.plannedAt)}
                      {shipment.actualAt
                        ? ` · réel le ${formatDate(shipment.actualAt)}`
                        : ""}
                      {` · ${receivedQty}/${totalQty} article(s) reçus`}
                    </p>
                    {shipment.comments ? (
                      <p className="mt-1 text-sm italic" style={{ color: "var(--muted)" }}>
                        {shipment.comments}
                      </p>
                    ) : null}
                  </div>
                  {receivable ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => openReception(shipment)}
                    >
                      <PackageOpen size={16} aria-hidden />
                      Réceptionner
                    </button>
                  ) : null}
                </div>

                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {shipment.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {item.quantity} × {item.productName}
                      </span>
                      {item.variant ? (
                        <span style={{ color: "var(--muted)" }}>({item.variant})</span>
                      ) : null}
                      <span
                        className="text-xs"
                        style={{
                          color:
                            item.quantityReceived >= item.quantity
                              ? "var(--success)"
                              : item.quantityReceived > 0
                                ? "var(--warning)"
                                : "var(--muted)",
                        }}
                      >
                        {item.quantityReceived}/{item.quantity} reçu(s)
                        {item.quantityReceived < item.quantity
                          ? ` — restant : ${item.quantity - item.quantityReceived}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>

                {shipment.legs.length > 1 ? (
                  <ol className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
                    {[...shipment.legs]
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((leg, i, arr) => {
                        const legStatus = shipmentStatusLabels[leg.status];
                        return (
                          <li key={leg.id} className="flex items-center gap-2">
                            <span
                              className="rounded-full px-2 py-0.5"
                              style={{ background: "var(--surface-muted)" }}
                            >
                              {leg.originLabel} → {leg.destinationLabel} ({legStatus.label})
                            </span>
                            {i < arr.length - 1 ? <span aria-hidden>›</span> : null}
                          </li>
                        );
                      })}
                  </ol>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Dialogue de réception (partielle ou totale) */}
      {receiving ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reception-title"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setReceiving(null)}
            aria-hidden
          />
          <form
            onSubmit={submitReception}
            className="card relative w-full max-w-lg p-5 shadow-xl"
          >
            <h2 id="reception-title" className="text-base font-semibold">
              Réception de {receiving.reference}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Indiquez les quantités réellement reçues. Une réception partielle
              laissera l&apos;arrivage en statut « Reçu partiellement ».
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {receiving.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3">
                  <label htmlFor={`recv-${item.id}`} className="text-sm">
                    {item.productName}
                    {item.variant ? ` (${item.variant})` : ""} — attendu : {item.quantity}
                  </label>
                  <input
                    id={`recv-${item.id}`}
                    type="number"
                    min="0"
                    max={item.quantity}
                    step="1"
                    className="field-input w-24"
                    value={receivedQuantities[item.id] ?? "0"}
                    onChange={(e) =>
                      setReceivedQuantities((q) => ({ ...q, [item.id]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReceiving(null)}
              >
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Enregistrer la réception
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
