"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ClipboardList,
  PackageCheck,
  PhoneOutgoing,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  computeReminders,
  globalRap,
  linesOfOrder,
  orderRap,
  orderTotal,
  refundAlerts,
} from "@/lib/derive";
import { formatDate, formatEuro, isToday } from "@/lib/format";
import { deliveryStatusLabels, originLabels } from "@/lib/labels";

export default function DashboardPage() {
  const { db, mode, storeFilter } = useData();

  if (!db) return <LoadingState />;

  const orders = db.orders.filter(
    (o) => storeFilter === "all" || o.storeId === storeFilter,
  );

  const ordersToday = orders.filter((o) => isToday(o.orderedAt));
  const shopifyOrders = orders.filter((o) => o.origin === "SHOPIFY");
  const storeOrders = orders.filter((o) => o.origin === "MAGASIN");

  const pendingApprovals = db.approvalRequests.filter(
    (r) => r.status === "en_attente",
  );
  const pendingSupplierOrders = db.supplierOrders.filter(
    (o) => o.status === "en_attente_validation",
  );

  const reminders = computeReminders(db).filter(
    (r) => storeFilter === "all" || r.order.storeId === storeFilter,
  );

  const now = Date.now();
  const lateShipments = db.shipments.filter(
    (s) =>
      !["recu", "annule"].includes(s.status) &&
      ((s.plannedAt && new Date(s.plannedAt).getTime() < now) ||
        s.status === "retarde"),
  );

  const receivedLines = db.orderLines.filter(
    (l) => l.procurementStatus === "recu_depot",
  );

  const deliveriesToPlan = orders.filter(
    (o) => o.status === "ouverte" && o.deliveryStatus === "a_planifier",
  );

  // RAP global calculé commande par commande : un trop-perçu éventuel sur
  // une commande ne diminue jamais le RAP d'une autre.
  const totalRap = globalRap(orders, db);

  const paymentsToday = db.payments.filter(
    (p) =>
      isToday(p.date) &&
      (storeFilter === "all" || !p.storeId || p.storeId === storeFilter),
  );
  const cashedToday = paymentsToday.reduce((sum, p) => sum + p.amount, 0);

  const refunds = refundAlerts(db).filter(
    (a) => storeFilter === "all" || a.order.storeId === storeFilter,
  );

  const alerts: { text: string; href: string }[] = [
    ...refunds.map((a) => ({
      text: `Remboursement ou avoir à traiter : ${formatEuro(a.amount)} (commande ${a.order.reference} annulée après encaissement).`,
      href: `/commandes/${a.order.id}`,
    })),
    ...reminders
      .filter((r) => r.overdueDays > 0)
      .map((r) => ({
        text: `Relance en retard de ${r.overdueDays} j : ${r.line.productName} (${r.order.reference}).`,
        href: "/relances",
      })),
    ...lateShipments.map((s) => ({
      text: `Arrivage ${s.reference} (${s.destinationLabel}) en retard ou retardé.`,
      href: "/arrivages",
    })),
    ...pendingApprovals.map((a) => ({
      text: `En attente de validation : ${a.title}.`,
      href: "/validations",
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Tableau de bord</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Vue d&apos;ensemble des commandes, approvisionnements et encaissements.
          </p>
        </div>
        {/* Skara reste la source de création des commandes : le raccourci
            n'existe plus qu'en mode démonstration. */}
        {mode === "demo" ? (
          <Link href="/commandes/nouvelle-magasin" className="btn-primary">
            <Store size={16} aria-hidden />
            Nouvelle commande magasin
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Commandes du jour"
          value={String(ordersToday.length)}
          hint={`${orders.length} commandes au total`}
          icon={ClipboardList}
        />
        <StatCard
          label="Commandes Shopify"
          value={String(shopifyOrders.length)}
          hint="Webhooks Shopify à venir"
          icon={ShoppingBag}
        />
        <StatCard
          label="Commandes magasin"
          value={String(storeOrders.length)}
          icon={Store}
        />
        <StatCard
          label="Commandes fournisseurs à valider"
          value={String(pendingSupplierOrders.length)}
          hint={`${pendingApprovals.length} validation(s) en attente`}
          icon={ShoppingCart}
          tone={pendingSupplierOrders.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Relances du lundi"
          value={`${reminders.filter((r) => r.due).length} à effectuer`}
          hint={`${reminders.filter((r) => !r.due).length} programmée(s)${
            reminders.filter((r) => r.overdueDays > 0).length > 0
              ? ` · ${reminders.filter((r) => r.overdueDays > 0).length} en retard`
              : ""
          }`}
          icon={PhoneOutgoing}
          tone={
            reminders.some((r) => r.overdueDays > 0)
              ? "danger"
              : reminders.some((r) => r.due)
                ? "warning"
                : "default"
          }
        />
        <StatCard
          label="Arrivages en retard"
          value={String(lateShipments.length)}
          icon={Truck}
          tone={lateShipments.length > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Articles reçus au dépôt"
          value={String(receivedLines.length)}
          icon={PackageCheck}
          tone="success"
        />
        <StatCard
          label="Livraisons à planifier"
          value={String(deliveriesToPlan.length)}
          icon={CalendarClock}
        />
        <StatCard
          label="Total des restes à payer (RAP)"
          value={formatEuro(totalRap)}
          icon={Wallet}
          tone={totalRap > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Encaissements du jour"
          value={formatEuro(cashedToday)}
          hint={`${paymentsToday.length} règlement(s) aujourd'hui`}
          icon={Banknote}
          tone="success"
        />
      </div>

      <section aria-labelledby="alertes-title" className="card p-4">
        <h2 id="alertes-title" className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle size={16} style={{ color: "var(--warning)" }} aria-hidden />
          Alertes prioritaires
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Aucune alerte : tout est à jour.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {alerts.slice(0, 6).map((alert, i) => (
              <li key={i}>
                <Link
                  href={alert.href}
                  className="flex items-start gap-2 rounded-md border p-2.5 text-sm transition hover:bg-black/[0.02]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: "var(--danger)" }}
                    aria-hidden
                  />
                  {alert.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-title" className="card">
        <div className="flex items-center justify-between p-4 pb-0">
          <h2 id="recent-title" className="text-sm font-semibold">
            Dernières commandes
          </h2>
          <Link href="/commandes" className="text-sm font-medium" style={{ color: "var(--primary)" }}>
            Tout voir
          </Link>
        </div>
        {orders.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Aucune commande pour ce magasin"
              description="Créez une commande magasin ou changez le filtre en haut de page."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Origine</th>
                  <th scope="col">Client</th>
                  <th scope="col">Total</th>
                  <th scope="col">RAP</th>
                  <th scope="col">Livraison</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {[...orders]
                  .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))
                  .slice(0, 6)
                  .map((order) => {
                    const customer = db.customers.find(
                      (c) => c.id === order.customerId,
                    );
                    const rap = orderRap(order, db.orderLines, db.payments);
                    const delivery = deliveryStatusLabels[order.deliveryStatus];
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
                        <td>{customer?.name ?? "—"}</td>
                        <td>{formatEuro(orderTotal(order, linesOfOrder(db, order.id)))}</td>
                        <td>
                          {rap > 0 ? (
                            <span style={{ color: "var(--danger)" }} className="font-medium">
                              {formatEuro(rap)}
                            </span>
                          ) : (
                            formatEuro(0)
                          )}
                        </td>
                        <td>
                          <Badge tone={delivery.tone}>{delivery.label}</Badge>
                        </td>
                        <td>{formatDate(order.orderedAt)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
