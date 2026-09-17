"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShoppingCart } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { SupplierOrderInfoTable } from "@/components/SupplierOrderInfoTable";
import { buildSupplierOrderInfo } from "@/lib/supplierOrderInfo";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  approvalStatusLabels,
  approvalTypeLabels,
  supplierOrderStatusLabels,
} from "@/lib/labels";
import type { Database, OrderLine, Supplier, SupplierOrder } from "@/lib/types";

type SoView =
  | "en_attente"
  | "validees"
  | "confirmees"
  | "terminees"
  | "archives"
  | "toutes";

/**
 * Vue d'une commande fournisseur :
 * - Terminées : toutes les lignes clients rattachées sont reçues au dépôt ;
 * - Archives : commandes annulées.
 */
function soView(so: SupplierOrder, db: Database): SoView {
  if (so.status === "annulee") return "archives";
  if (so.status === "en_attente_validation" || so.status === "proposition") {
    return "en_attente";
  }
  const lineIds = so.lines
    .map((l) => l.orderLineId)
    .filter((id): id is string => Boolean(id));
  const allReceived =
    lineIds.length > 0 &&
    lineIds.every(
      (id) =>
        db.orderLines.find((l) => l.id === id)?.procurementStatus === "recu_depot",
    );
  if (allReceived) return "terminees";
  return so.status === "confirmee" ? "confirmees" : "validees";
}

export default function PurchasesPage() {
  const { db, prepareSupplierOrder, decideApproval } = useData();
  const { notify } = useToast();
  const [view, setView] = useState<SoView>("toutes");
  const [proposalToConfirm, setProposalToConfirm] = useState<{
    supplier: Supplier;
    lines: OrderLine[];
  } | null>(null);
  const [approvalToDecide, setApprovalToDecide] = useState<{
    id: string;
    approved: boolean;
    title: string;
  } | null>(null);

  if (!db) return <LoadingState />;

  // Propositions : lignes "à commander" regroupées par fournisseur principal.
  const toOrder = db.orderLines.filter((l) => {
    if (l.procurementStatus !== "a_commander") return false;
    const order = db.orders.find((o) => o.id === l.orderId);
    return order && order.status !== "annulee";
  });
  const bySupplier = new Map<string, OrderLine[]>();
  for (const line of toOrder) {
    const key = line.supplierId ?? "none";
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), line]);
  }

  const pendingApprovals = db.approvalRequests.filter(
    (r) => r.status === "en_attente" && r.relatedSupplierOrderId,
  );

  const allSupplierOrders = [...db.supplierOrders].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const supplierOrders =
    view === "toutes"
      ? allSupplierOrders
      : allSupplierOrders.filter((so) => soView(so, db) === view);
  const countFor = (v: SoView) =>
    allSupplierOrders.filter((so) => soView(so, db) === v).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Achats fournisseurs</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Propositions regroupées par fournisseur. Toute commande doit être
          validée par un humain — aucun envoi réel n&apos;est effectué dans cette
          version.
        </p>
      </div>

      {/* Propositions à préparer */}
      <section aria-labelledby="propositions-title" className="flex flex-col gap-3">
        <h2 id="propositions-title" className="text-sm font-semibold">
          Articles à commander
        </h2>
        {bySupplier.size === 0 ? (
          <EmptyState
            title="Aucun article à commander"
            description="Les articles passés en statut « À commander » apparaîtront ici, regroupés par fournisseur."
            icon={ShoppingCart}
          />
        ) : (
          Array.from(bySupplier.entries()).map(([supplierId, lines]) => {
            const supplier = db.suppliers.find((s) => s.id === supplierId);
            return (
              <div key={supplierId} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {supplier?.name ?? "Fournisseur à déterminer"}
                    </p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {lines.length} article(s)
                      {supplier?.usualOrderDay
                        ? ` · commande habituelle le ${supplier.usualOrderDay}`
                        : ""}
                      {supplier?.leadTimeDays
                        ? ` · délai ${supplier.leadTimeDays} j`
                        : ""}
                    </p>
                  </div>
                  {supplier ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setProposalToConfirm({ supplier, lines })}
                    >
                      <ShieldCheck size={16} aria-hidden />
                      Préparer la commande
                    </button>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--warning)" }}>
                      Assignez d&apos;abord un fournisseur à ces articles.
                    </p>
                  )}
                </div>
                <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                  {lines.map((line) => {
                    const order = db.orders.find((o) => o.id === line.orderId);
                    return (
                      <li key={line.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {line.quantity} × {line.productName}
                        </span>
                        {line.variant ? (
                          <span style={{ color: "var(--muted)" }}>({line.variant})</span>
                        ) : null}
                        {order ? (
                          <Link
                            href={`/commandes/${order.id}`}
                            className="text-xs font-medium"
                            style={{ color: "var(--primary)" }}
                          >
                            {order.reference}
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {/* Validations en attente */}
      <section aria-labelledby="validations-title" className="flex flex-col gap-3">
        <h2 id="validations-title" className="text-sm font-semibold">
          Validations en attente
        </h2>
        {pendingApprovals.length === 0 ? (
          <EmptyState
            title="Aucune validation en attente"
            description="Les propositions de commandes fournisseurs à valider apparaîtront ici."
            icon={ShieldCheck}
          />
        ) : (
          pendingApprovals.map((approval) => {
            const so = db.supplierOrders.find(
              (o) => o.id === approval.relatedSupplierOrderId,
            );
            const supplier = so
              ? db.suppliers.find((s) => s.id === so.supplierId)
              : undefined;
            const status = approvalStatusLabels[approval.status];
            return (
              <div key={approval.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{approval.title}</p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                      {approvalTypeLabels[approval.type]} · créée le{" "}
                      {formatDateTime(approval.createdAt)}
                    </p>
                    <p className="mt-2 text-sm">{approval.description}</p>
                    {so ? (
                      <SupplierOrderInfoTable info={buildSupplierOrderInfo(db, so)} />
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() =>
                        setApprovalToDecide({
                          id: approval.id,
                          approved: true,
                          title: approval.title,
                        })
                      }
                    >
                      Valider
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        setApprovalToDecide({
                          id: approval.id,
                          approved: false,
                          title: approval.title,
                        })
                      }
                    >
                      Refuser
                    </button>
                  </div>
                </div>
                {supplier ? (
                  <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                    Rappel : après validation, la commande devra être transmise à{" "}
                    {supplier.name} manuellement (WhatsApp, site…). Aucun message
                    n&apos;est envoyé automatiquement.
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </section>

      {/* Historique des commandes fournisseurs */}
      <section aria-labelledby="historique-title" className="flex flex-col gap-3">
        <h2 id="historique-title" className="text-sm font-semibold">
          Commandes fournisseurs
        </h2>
        <ViewTabs<SoView>
          ariaLabel="Filtrer les commandes fournisseurs"
          value={view}
          onChange={setView}
          tabs={[
            { key: "en_attente", label: "En attente de validation", count: countFor("en_attente") },
            { key: "validees", label: "Validées", count: countFor("validees") },
            { key: "confirmees", label: "Confirmées fournisseur", count: countFor("confirmees") },
            { key: "terminees", label: "Terminées", count: countFor("terminees") },
            { key: "archives", label: "Archives", count: countFor("archives") },
            { key: "toutes", label: "Toutes" },
          ]}
        />
        {supplierOrders.length === 0 ? (
          <EmptyState title="Aucune commande fournisseur dans cette vue" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Fournisseur</th>
                  <th scope="col">Articles</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Créée le</th>
                  <th scope="col">Validée par</th>
                  <th scope="col">Attendue le</th>
                </tr>
              </thead>
              <tbody>
                {supplierOrders.map((so) => {
                  const supplier = db.suppliers.find((s) => s.id === so.supplierId);
                  const status = supplierOrderStatusLabels[so.status];
                  return (
                    <tr key={so.id}>
                      <td className="font-medium">{so.reference}</td>
                      <td>{supplier?.name ?? "—"}</td>
                      <td>{so.lines.reduce((sum, l) => sum + l.quantity, 0)}</td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="whitespace-nowrap">{formatDate(so.createdAt)}</td>
                      <td>{so.validatedBy ?? "—"}</td>
                      <td className="whitespace-nowrap">{formatDate(so.expectedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={proposalToConfirm !== null}
        title={`Préparer la commande ${proposalToConfirm?.supplier.name ?? ""} ?`}
        description={`${proposalToConfirm?.lines.length ?? 0} article(s) seront regroupés dans une proposition de commande fournisseur. Elle devra ensuite être validée par un humain — aucun envoi réel ne sera effectué.`}
        confirmLabel="Préparer la proposition"
        onConfirm={async () => {
          if (proposalToConfirm) {
            try {
              await prepareSupplierOrder(
                proposalToConfirm.supplier.id,
                proposalToConfirm.lines.map((l) => l.id),
              );
              notify("Proposition créée, en attente de validation humaine.");
            } catch (err) {
              notify(
                err instanceof Error ? err.message : "Action impossible.",
                "error",
              );
            }
          }
          setProposalToConfirm(null);
        }}
        onCancel={() => setProposalToConfirm(null)}
      />

      <ConfirmDialog
        open={approvalToDecide !== null}
        title={
          approvalToDecide?.approved
            ? "Valider cette commande fournisseur ?"
            : "Refuser cette commande fournisseur ?"
        }
        description={`${approvalToDecide?.title ?? ""} — la validation met à jour le suivi interne. La transmission au fournisseur reste manuelle dans cette version.`}
        confirmLabel={approvalToDecide?.approved ? "Valider" : "Refuser"}
        danger={!approvalToDecide?.approved}
        onConfirm={async () => {
          if (approvalToDecide) {
            try {
              await decideApproval(
                approvalToDecide.id,
                approvalToDecide.approved,
                "Responsable achats",
              );
              notify(
                approvalToDecide.approved
                  ? "Commande fournisseur validée."
                  : "Proposition refusée, articles remis « À commander ».",
              );
            } catch (err) {
              notify(
                err instanceof Error ? err.message : "Action impossible.",
                "error",
              );
            }
          }
          setApprovalToDecide(null);
        }}
        onCancel={() => setApprovalToDecide(null)}
      />
    </div>
  );
}
