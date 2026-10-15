"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { PaginationBar, usePagination } from "@/components/ui/Pagination";
import {
  PeriodFilter,
  inPeriod,
  previousPeriod,
  type PeriodValue,
} from "@/components/ui/PeriodFilter";
import { linesOfOrder, orderTotalCents } from "@/lib/derive";
import { fromCents } from "@/lib/money";
import { formatDate, formatEuro } from "@/lib/format";
import { acquisitionSourceLabels, originLabels } from "@/lib/labels";
import type { AcquisitionSource, Order, OrderOrigin } from "@/lib/types";

const ALL_SOURCES = Object.keys(acquisitionSourceLabels) as AcquisitionSource[];

export default function AcquisitionPage() {
  const { db, storeFilter } = useData();
  const [period, setPeriod] = useState<PeriodValue>({ key: "toutes" });
  const [store, setStore] = useState("all");
  const [origin, setOrigin] = useState<"all" | OrderOrigin>("all");
  const [source, setSource] = useState<"all" | AcquisitionSource | "non_attribue">("all");

  const effectiveStore = store !== "all" ? store : storeFilter;

  const baseFilter = useMemo(() => {
    return (o: Order) =>
      o.status !== "annulee" &&
      (effectiveStore === "all" || o.storeId === effectiveStore) &&
      (origin === "all" || o.origin === origin);
  }, [effectiveStore, origin]);

  const orders = useMemo(() => {
    if (!db) return [];
    return db.orders
      .filter(baseFilter)
      .filter((o) => inPeriod(o.orderedAt, period))
      .filter((o) =>
        source === "all"
          ? true
          : source === "non_attribue"
            ? !o.acquisitionSource
            : o.acquisitionSource === source,
      )
      .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
  }, [db, baseFilter, period, source]);

  // Statistiques par source (commandes + chiffre d'affaires attribué).
  const stats = useMemo(() => {
    if (!db) return null;
    const inScope = db.orders
      .filter(baseFilter)
      .filter((o) => inPeriod(o.orderedAt, period));
    const bySource = new Map<string, { count: number; revenueCents: number }>();
    for (const key of [...ALL_SOURCES, "non_attribue"]) {
      bySource.set(key, { count: 0, revenueCents: 0 });
    }
    for (const order of inScope) {
      const key = order.acquisitionSource ?? "non_attribue";
      const entry = bySource.get(key)!;
      entry.count += 1;
      entry.revenueCents += orderTotalCents(order, linesOfOrder(db, order.id));
    }

    // Comparaison avec la période précédente (si une période est définie).
    const prev = previousPeriod(period);
    let prevCount: number | null = null;
    let prevRevenueCents: number | null = null;
    if (prev) {
      const prevOrders = db.orders
        .filter(baseFilter)
        .filter((o) => inPeriod(o.orderedAt, prev));
      prevCount = prevOrders.length;
      prevRevenueCents = prevOrders.reduce(
        (sum, o) => sum + orderTotalCents(o, linesOfOrder(db, o.id)),
        0,
      );
    }
    const totalCount = inScope.length;
    const totalRevenueCents = inScope.reduce(
      (sum, o) => sum + orderTotalCents(o, linesOfOrder(db, o.id)),
      0,
    );
    return { bySource, totalCount, totalRevenueCents, prevCount, prevRevenueCents };
  }, [db, baseFilter, period]);

  const pagination = usePagination(orders);

  if (!db || !stats) return <LoadingState />;

  const maxCount = Math.max(
    1,
    ...Array.from(stats.bySource.values()).map((v) => v.count),
  );

  const sourceKindBadge = (order: Order) => {
    if (!order.acquisitionSource) return <Badge tone="neutral">Non attribué</Badge>;
    return order.origin === "SHOPIFY" ? (
      <Badge tone="info">Source mesurée</Badge>
    ) : (
      <Badge tone="violet">Source déclarée</Badge>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Acquisition marketing</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Une <strong>source déclarée</strong> (dite par le client en magasin)
          et une <strong>source mesurée</strong> (données de visite Shopify) ne
          sont pas des données de même nature : elles sont signalées
          distinctement.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <label>
          <span className="sr-only">Magasin</span>
          <select
            className="field-input w-auto"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          >
            <option value="all">Tous les magasins</option>
            {db.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Origine</span>
          <select
            className="field-input w-auto"
            value={origin}
            onChange={(e) => setOrigin(e.target.value as "all" | OrderOrigin)}
          >
            <option value="all">Shopify + magasin</option>
            <option value="SHOPIFY">Shopify</option>
            <option value="MAGASIN">Magasin</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Source</span>
          <select
            className="field-input w-auto"
            value={source}
            onChange={(e) =>
              setSource(e.target.value as "all" | AcquisitionSource | "non_attribue")
            }
          >
            <option value="all">Toutes les sources</option>
            {ALL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {acquisitionSourceLabels[s]}
              </option>
            ))}
            <option value="non_attribue">Non attribué</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Commandes sur la période
          </p>
          <p className="mt-1 text-2xl font-semibold">{stats.totalCount}</p>
          {stats.prevCount !== null ? (
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Période précédente : {stats.prevCount} commande(s)
            </p>
          ) : null}
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Chiffre d&apos;affaires attribué
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {formatEuro(fromCents(stats.totalRevenueCents))}
          </p>
          {stats.prevRevenueCents !== null ? (
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Période précédente : {formatEuro(fromCents(stats.prevRevenueCents))}
            </p>
          ) : null}
        </div>
      </div>

      <section className="card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone size={16} aria-hidden style={{ color: "var(--primary)" }} />
          Commandes et chiffre d&apos;affaires par source
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {[...ALL_SOURCES, "non_attribue" as const].map((key) => {
            const entry = stats.bySource.get(key)!;
            const label =
              key === "non_attribue"
                ? "Non attribué"
                : acquisitionSourceLabels[key as AcquisitionSource];
            return (
              <li key={key} className="flex items-center gap-3">
                <span className="w-48 shrink-0 text-sm">{label}</span>
                <div
                  className="h-4 flex-1 overflow-hidden rounded"
                  style={{ background: "var(--surface-muted)" }}
                  role="img"
                  aria-label={`${label} : ${entry.count} commande(s), ${formatEuro(fromCents(entry.revenueCents))}`}
                >
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${(entry.count / maxCount) * 100}%`,
                      background:
                        key === "non_attribue" ? "var(--muted)" : "var(--primary)",
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-semibold">
                  {entry.count}
                </span>
                <span
                  className="w-28 shrink-0 text-right text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  {formatEuro(fromCents(entry.revenueCents))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Détail des commandes</h2>
        {orders.length === 0 ? (
          <EmptyState
            title="Aucune commande sur cette période"
            description="Modifiez la période ou les filtres."
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Commande</th>
                  <th scope="col">Date</th>
                  <th scope="col">Source</th>
                  <th scope="col">Nature</th>
                  <th scope="col">Première page / UTM</th>
                  <th scope="col">Conversion</th>
                  <th scope="col">Client</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {pagination.paged.map((order) => {
                  const journey = db.acquisitionJourneys.find(
                    (j) => j.orderId === order.id,
                  );
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
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          {originLabels[order.origin]}
                        </p>
                      </td>
                      <td className="whitespace-nowrap">{formatDate(order.orderedAt)}</td>
                      <td>
                        {order.acquisitionSource
                          ? acquisitionSourceLabels[order.acquisitionSource]
                          : "—"}
                      </td>
                      <td>{sourceKindBadge(order)}</td>
                      <td>
                        {journey?.landingPage ? (
                          <p className="break-all text-sm">{journey.landingPage}</p>
                        ) : null}
                        {journey?.utmSource ? (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            {journey.utmSource} / {journey.utmMedium ?? "—"} /{" "}
                            {journey.utmCampaign ?? "—"}
                          </p>
                        ) : null}
                        {!journey?.landingPage && !journey?.utmSource ? "—" : null}
                      </td>
                      <td>
                        {journey?.daysToConversion !== undefined
                          ? `${journey.daysToConversion} j`
                          : "—"}
                      </td>
                      <td>
                        {db.customers.find((c) => c.id === order.customerId)?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {formatEuro(
                          fromCents(orderTotalCents(order, linesOfOrder(db, order.id))),
                        )}
                      </td>
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
      </section>
    </div>
  );
}
