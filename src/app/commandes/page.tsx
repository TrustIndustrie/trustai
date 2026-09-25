"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { PaginationBar, usePagination } from "@/components/ui/Pagination";
import {
  PeriodFilter,
  inPeriod,
  type PeriodValue,
} from "@/components/ui/PeriodFilter";
import {
  linesOfOrder,
  orderPaymentStatus,
  orderProgress,
  orderRap,
  orderTotal,
} from "@/lib/derive";
import { formatDate, formatEuro } from "@/lib/format";
import {
  originLabels,
  paymentStatusLabels,
  procurementStatusLabels,
} from "@/lib/labels";
import type { Database, Order, OrderOrigin, ProcurementStatus } from "@/lib/types";

type Tab = "toutes" | "shopify" | "magasin";
type ViewKey = "a_traiter" | "en_cours" | "terminees" | "annulees" | "toutes";

/**
 * Vues d'état :
 * - À traiter : commandes ouvertes avec au moins un article qui attend une
 *   action (à vérifier, à commander, validation, indisponible, relance) ;
 * - En cours : autres commandes ouvertes ;
 * - Terminées / Annulées : selon le statut de la commande.
 */
function matchesView(order: Order, db: Database, view: ViewKey): boolean {
  if (view === "toutes") return true;
  if (view === "terminees") return order.status === "terminee";
  if (view === "annulees") return order.status === "annulee";
  if (order.status !== "ouverte") return false;
  const needsAction = db.orderLines.some(
    (l) =>
      l.orderId === order.id &&
      ["a_verifier", "a_commander", "en_attente_validation", "indisponible", "relance_due"].includes(
        l.procurementStatus,
      ),
  );
  return view === "a_traiter" ? needsAction : !needsAction;
}

export default function OrdersPage() {
  const { db, mode, storeFilter } = useData();
  const [tab, setTab] = useState<Tab>("toutes");
  const [view, setView] = useState<ViewKey>("toutes");
  const [period, setPeriod] = useState<PeriodValue>({ key: "toutes" });
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("all");
  const [status, setStatus] = useState<"all" | ProcurementStatus>("all");
  const [origin, setOrigin] = useState<"all" | OrderOrigin>("all");
  const [store, setStore] = useState("all");

  const orders = useMemo(() => {
    if (!db) return [];
    return db.orders
      .filter((o) => storeFilter === "all" || o.storeId === storeFilter)
      .filter((o) =>
        tab === "toutes" ? true : tab === "shopify" ? o.origin === "SHOPIFY" : o.origin === "MAGASIN",
      )
      .filter((o) => matchesView(o, db, view))
      .filter((o) => inPeriod(o.orderedAt, period))
      .filter((o) => origin === "all" || o.origin === origin)
      .filter((o) => store === "all" || o.storeId === store)
      .filter((o) => {
        if (supplierId === "all" && status === "all") return true;
        const lines = db.orderLines.filter((l) => l.orderId === o.id);
        const supplierOk =
          supplierId === "all" ||
          lines.some(
            (l) => l.supplierId === supplierId || l.altSupplierId === supplierId,
          );
        const statusOk =
          status === "all" || lines.some((l) => l.procurementStatus === status);
        return supplierOk && statusOk;
      })
      .filter((o) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        const customer = db.customers.find((c) => c.id === o.customerId);
        const lines = db.orderLines.filter((l) => l.orderId === o.id);
        return (
          o.reference.toLowerCase().includes(q) ||
          (customer?.name.toLowerCase().includes(q) ?? false) ||
          lines.some((l) => l.productName.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
  }, [db, storeFilter, tab, view, period, search, supplierId, status, origin, store]);

  const pagination = usePagination(orders);

  if (!db) return <LoadingState />;

  const tabs: { key: Tab; label: string }[] = [
    { key: "toutes", label: "Toutes" },
    { key: "shopify", label: "Shopify" },
    { key: "magasin", label: "Magasin" },
  ];

  const baseOrders = db.orders.filter(
    (o) => storeFilter === "all" || o.storeId === storeFilter,
  );
  const viewCount = (v: ViewKey) =>
    baseOrders.filter((o) => matchesView(o, db, v)).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Commandes</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Commandes Shopify et magasin, avec suivi article par article.
          </p>
        </div>
        {/* Voir le tableau de bord : création réservée au mode démonstration. */}
        {mode === "demo" ? (
          <Link href="/commandes/nouvelle-magasin" className="btn-primary">
            <Plus size={16} aria-hidden />
            Nouvelle commande magasin
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ViewTabs<ViewKey>
          ariaLabel="Filtrer par état"
          value={view}
          onChange={setView}
          tabs={[
            { key: "a_traiter", label: "À traiter", count: viewCount("a_traiter") },
            { key: "en_cours", label: "En cours", count: viewCount("en_cours") },
            { key: "terminees", label: "Terminées", count: viewCount("terminees") },
            { key: "annulees", label: "Annulées", count: viewCount("annulees") },
            { key: "toutes", label: "Toutes" },
          ]}
        />
        <ViewTabs<Tab>
          ariaLabel="Filtrer par origine"
          value={tab}
          onChange={setTab}
          tabs={tabs}
        />
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative sm:col-span-2 lg:col-span-2">
          <span className="sr-only">Rechercher</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted)" }}
            aria-hidden
          />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Rechercher une référence, un client, un produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Origine</span>
          <select
            className="field-input"
            value={origin}
            onChange={(e) => setOrigin(e.target.value as "all" | OrderOrigin)}
          >
            <option value="all">Toutes origines</option>
            <option value="SHOPIFY">Shopify</option>
            <option value="MAGASIN">Magasin</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Magasin</span>
          <select
            className="field-input"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          >
            <option value="all">Tous magasins</option>
            {db.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Fournisseur</span>
          <select
            className="field-input"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="all">Tous fournisseurs</option>
            {db.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Statut d&apos;approvisionnement</span>
          <select
            className="field-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as "all" | ProcurementStatus)}
          >
            <option value="all">Tous statuts article</option>
            {Object.entries(procurementStatusLabels).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title="Aucune commande ne correspond aux filtres"
          description="Modifiez la recherche ou les filtres, ou créez une nouvelle commande magasin."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th scope="col">Référence</th>
                <th scope="col">Origine</th>
                <th scope="col">Magasin</th>
                <th scope="col">Client</th>
                <th scope="col">Articles</th>
                <th scope="col">Total</th>
                <th scope="col">RAP</th>
                <th scope="col">Paiement</th>
                <th scope="col">
                  <span
                    title="Part des articles de la commande déjà disponibles en stock ou reçus au dépôt."
                    className="cursor-help underline decoration-dotted underline-offset-2"
                  >
                    Avancement logistique
                  </span>
                </th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {pagination.paged.map((order) => {
                const customer = db.customers.find((c) => c.id === order.customerId);
                const lines = linesOfOrder(db, order.id);
                const total = orderTotal(order, lines);
                const rap = orderRap(order, lines, db.payments);
                const payment = paymentStatusLabels[orderPaymentStatus(order, lines, db.payments)];
                const progress = orderProgress(order, lines);
                const storeName = db.stores.find((s) => s.id === order.storeId)?.name;
                return (
                  <tr key={order.id}>
                    <td>
                      <Link
                        href={`/commandes/${order.id}`}
                        className="font-medium"
                        style={{ color: "var(--primary)" }}
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td>{originLabels[order.origin]}</td>
                    <td>{storeName ?? "—"}</td>
                    <td>{customer?.name ?? "—"}</td>
                    <td>{lines.reduce((s, l) => s + l.quantity, 0)}</td>
                    <td className="whitespace-nowrap">{formatEuro(total)}</td>
                    <td className="whitespace-nowrap">
                      {rap > 0 ? (
                        <span className="font-medium" style={{ color: "var(--danger)" }}>
                          {formatEuro(rap)}
                        </span>
                      ) : (
                        formatEuro(Math.max(0, rap))
                      )}
                    </td>
                    <td>
                      <Badge tone={payment.tone}>{payment.label}</Badge>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-1.5 w-16 overflow-hidden rounded-full"
                          style={{ background: "var(--surface-muted)" }}
                          role="progressbar"
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${progress}%`, background: "var(--primary)" }}
                          />
                        </div>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {progress}%
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(order.orderedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationBar
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>
      )}
    </div>
  );
}
