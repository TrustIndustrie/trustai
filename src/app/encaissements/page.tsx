"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Banknote, Receipt, RotateCcw, Search, Wallet } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { PaginationBar, usePagination } from "@/components/ui/Pagination";
import {
  computeMonthSynthesis,
  scopedPayments,
  type CashScope,
} from "@/lib/cash";
import { orderPaid } from "@/lib/derive";
import { fromCents } from "@/lib/money";
import { formatDate, formatEuro } from "@/lib/format";
import { paymentMethodLabels } from "@/lib/labels";
import type { PaymentMethod } from "@/lib/types";

type ViewKey = "synthese" | "details";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function CashPage() {
  const { db, storeFilter } = useData();
  const [view, setView] = useState<ViewKey>("synthese");
  const [month, setMonth] = useState(currentMonth());
  const [store, setStore] = useState("all");
  const [salesperson, setSalesperson] = useState("all");
  const [method, setMethod] = useState<"all" | PaymentMethod>("all");
  const [dayFilter, setDayFilter] = useState<string | "">("");
  const [search, setSearch] = useState("");

  const scope = useMemo<CashScope>(
    () => ({
      storeId: store !== "all" ? store : storeFilter,
      salespersonId: salesperson,
    }),
    [store, storeFilter, salesperson],
  );

  const synthesis = useMemo(
    () => (db ? computeMonthSynthesis(db, month, scope) : null),
    [db, month, scope],
  );

  // Détail des règlements (paginé).
  const detailPayments = useMemo(() => {
    if (!db) return [];
    const q = search.trim().toLowerCase();
    return scopedPayments(db, scope)
      .filter((p) => {
        const day = p.date.slice(0, 10);
        if (dayFilter) return day === dayFilter;
        return day.startsWith(month);
      })
      .filter((p) => method === "all" || p.method === method)
      .filter((p) => {
        if (!q) return true;
        const order = db.orders.find((o) => o.id === p.orderId);
        const customer = order
          ? db.customers.find((c) => c.id === order.customerId)
          : undefined;
        return (
          (order?.reference.toLowerCase().includes(q) ?? false) ||
          (customer?.name.toLowerCase().includes(q) ?? false) ||
          (p.comment?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db, scope, month, dayFilter, method, search]);

  const pagination = usePagination(detailPayments);

  if (!db || !synthesis) return <LoadingState />;

  const totals = synthesis.totals;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Encaissements</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Récapitulatif calculé automatiquement depuis les commandes et les
          règlements. « Facturé actif » : commandes non annulées créées dans
          la période. « Encaissé brut » : tous les règlements reçus dans la
          période, y compris ceux de commandes annulées ensuite.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ViewTabs<ViewKey>
          ariaLabel="Choisir la vue"
          value={view}
          onChange={(v) => {
            setView(v);
            if (v === "synthese") setDayFilter("");
          }}
          tabs={[
            { key: "synthese", label: "Synthèse mensuelle" },
            { key: "details", label: "Détail des règlements" },
          ]}
        />
        <label>
          <span className="sr-only">Mois</span>
          <input
            type="month"
            className="field-input w-auto"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setDayFilter("");
            }}
          />
        </label>
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
          <span className="sr-only">Vendeuse / vendeur</span>
          <select
            className="field-input w-auto"
            value={salesperson}
            onChange={(e) => setSalesperson(e.target.value)}
          >
            <option value="all">Toute l&apos;équipe</option>
            {db.salespeople.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {view === "details" ? (
          <label>
            <span className="sr-only">Moyen de paiement</span>
            <select
              className="field-input w-auto"
              value={method}
              onChange={(e) => setMethod(e.target.value as "all" | PaymentMethod)}
            >
              <option value="all">Tous les moyens</option>
              {Object.entries(paymentMethodLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Facturé actif (mois)"
          value={formatEuro(fromCents(totals.invoicedCents))}
          icon={Receipt}
          hint="Commandes non annulées créées dans la période"
        />
        <StatCard
          label="Encaissé brut (mois)"
          value={formatEuro(fromCents(totals.collectedCents))}
          icon={Wallet}
          tone="success"
          hint="Tous les règlements reçus, y compris commandes annulées ensuite"
        />
        <StatCard
          label="RAP actif des commandes du mois"
          value={formatEuro(fromCents(totals.rapCents))}
          icon={Banknote}
          tone={totals.rapCents > 0 ? "warning" : "success"}
          hint="Commandes non annulées uniquement, calcul commande par commande"
        />
        <StatCard
          label="Remboursements / avoirs à traiter"
          value={formatEuro(fromCents(totals.toTreatCents))}
          icon={RotateCcw}
          tone={totals.toTreatCents > 0 ? "danger" : "default"}
          hint="Encaissements du mois sur commandes annulées, non traités"
        />
        <StatCard
          label="Remboursements / avoirs effectués"
          value={formatEuro(fromCents(totals.refundDoneCents))}
          tone={totals.refundDoneCents < 0 ? "danger" : "default"}
          hint="Uniquement les opérations réellement enregistrées"
        />
      </div>

      {view === "synthese" ? (
        synthesis.rows.length === 0 ? (
          <EmptyState
            title="Aucune activité sur ce mois"
            description="Changez de mois ou de filtres pour voir les journées."
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Facturé actif</th>
                  <th scope="col">Encaissé brut</th>
                  <th scope="col">Espèces</th>
                  <th scope="col">Carte</th>
                  <th scope="col">Virement</th>
                  <th scope="col">Financements</th>
                  <th scope="col">Avoirs</th>
                  <th scope="col">Remb. effectués</th>
                  <th scope="col">À traiter</th>
                  <th scope="col">RAP du jour</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {synthesis.rows.map((row) => (
                  <tr key={row.day}>
                    <td className="whitespace-nowrap font-medium">
                      {formatDate(`${row.day}T12:00:00`)}
                    </td>
                    <td className="whitespace-nowrap">
                      {formatEuro(fromCents(row.invoicedCents))}
                    </td>
                    <td className="whitespace-nowrap font-medium">
                      {formatEuro(fromCents(row.collectedCents))}
                    </td>
                    <td className="whitespace-nowrap">{formatEuro(fromCents(row.cashCents))}</td>
                    <td className="whitespace-nowrap">{formatEuro(fromCents(row.cardCents))}</td>
                    <td className="whitespace-nowrap">
                      {formatEuro(fromCents(row.transferCents))}
                    </td>
                    <td className="whitespace-nowrap">
                      {formatEuro(fromCents(row.financingCents))}
                    </td>
                    <td className="whitespace-nowrap">
                      {formatEuro(fromCents(row.creditCents))}
                    </td>
                    <td
                      className="whitespace-nowrap"
                      style={{
                        color: row.refundDoneCents < 0 ? "var(--danger)" : undefined,
                      }}
                    >
                      {formatEuro(fromCents(row.refundDoneCents))}
                    </td>
                    <td
                      className="whitespace-nowrap"
                      style={{
                        color: row.toTreatCents > 0 ? "var(--danger)" : undefined,
                      }}
                    >
                      {formatEuro(fromCents(row.toTreatCents))}
                    </td>
                    <td
                      className="whitespace-nowrap"
                      style={{ color: row.rapCents > 0 ? "var(--danger)" : undefined }}
                    >
                      {formatEuro(fromCents(row.rapCents))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-sm font-medium"
                        style={{ color: "var(--primary)" }}
                        onClick={() => {
                          setDayFilter(row.day);
                          setView("details");
                        }}
                      >
                        Voir le détail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          <div className="card flex flex-wrap items-center gap-3 p-4">
            <label className="relative min-w-64 flex-1">
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
                placeholder="Rechercher une commande, un client, un commentaire…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {dayFilter ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDayFilter("")}
              >
                Journée du {formatDate(`${dayFilter}T12:00:00`)} — afficher tout
                le mois
              </button>
            ) : null}
          </div>

          {detailPayments.length === 0 ? (
            <EmptyState
              title="Aucun règlement sur cette période"
              description="Modifiez le mois, la journée ou les filtres."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Commande</th>
                    <th scope="col">Magasin</th>
                    <th scope="col">Vendeuse / vendeur</th>
                    <th scope="col">Moyen de paiement</th>
                    <th scope="col">Montant</th>
                    <th scope="col">Commentaire</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.paged.map((payment) => {
                    const order = db.orders.find((o) => o.id === payment.orderId);
                    const storeName = db.stores.find(
                      (s) => s.id === payment.storeId,
                    )?.name;
                    const cashier = db.salespeople.find(
                      (s) => s.id === payment.salespersonId,
                    )?.name;
                    const cancelled =
                      order?.status === "annulee" &&
                      orderPaid(order, db.payments) > 0;
                    return (
                      <tr key={payment.id}>
                        <td className="whitespace-nowrap">{formatDate(payment.date)}</td>
                        <td>
                          {order ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Link
                                href={`/commandes/${order.id}`}
                                className="font-medium"
                                style={{ color: "var(--primary)" }}
                              >
                                {order.reference}
                              </Link>
                              {cancelled ? (
                                <Badge tone="danger">
                                  Commande annulée — à traiter
                                </Badge>
                              ) : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{storeName ?? "En ligne"}</td>
                        <td>{cashier ?? "—"}</td>
                        <td>{paymentMethodLabels[payment.method]}</td>
                        <td
                          className="whitespace-nowrap font-medium"
                          style={{
                            color: payment.amount < 0 ? "var(--danger)" : undefined,
                          }}
                        >
                          {formatEuro(payment.amount)}
                        </td>
                        <td style={{ color: "var(--muted)" }}>
                          {payment.comment ?? "—"}
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
        </>
      )}
    </div>
  );
}
