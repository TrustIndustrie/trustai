"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, Search } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { supplierChannelLabels, supplierLogisticsLabels } from "@/lib/labels";

export default function SuppliersPage() {
  const { db } = useData();
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);

  if (!db) return <LoadingState />;

  const suppliers = db.suppliers
    .filter((s) => !onlyActive || s.active)
    .filter((s) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.specialties.some((sp) => sp.toLowerCase().includes(q)) ||
        (s.country?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Fournisseurs</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Fiches fournisseurs, canaux de commande et jours de retrait.
        </p>
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Rechercher un fournisseur</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted)" }}
            aria-hidden
          />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Rechercher par nom, spécialité, pays…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
          />
          Actifs uniquement
        </label>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          title="Aucun fournisseur trouvé"
          icon={Building2}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((supplier) => (
            <Link
              key={supplier.id}
              href={`/fournisseurs/${supplier.id}`}
              className="card flex flex-col gap-2 p-4 transition hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{supplier.name}</p>
                <Badge tone={supplier.active ? "success" : "neutral"}>
                  {supplier.active ? "Actif" : "Inactif"}
                </Badge>
              </div>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {supplier.specialties.join(" · ")}
                {supplier.country ? ` — ${supplier.country}` : ""}
              </p>
              <p className="text-sm">
                Commande via {supplierChannelLabels[supplier.orderChannel]}
                {supplier.leadTimeDays ? ` · délai ${supplier.leadTimeDays} j` : ""}
              </p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {supplierLogisticsLabels[supplier.logistics]}
                {supplier.usualOrderDay
                  ? ` · commande le ${supplier.usualOrderDay}`
                  : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
