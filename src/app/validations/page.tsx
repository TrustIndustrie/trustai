"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckSquare, X } from "lucide-react";
import { useData, BusinessError } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { PaginationBar, usePagination } from "@/components/ui/Pagination";
import { SupplierOrderInfoTable } from "@/components/SupplierOrderInfoTable";
import { linesOfOrder, orderPaid, orderTotal } from "@/lib/derive";
import { buildSupplierOrderInfo } from "@/lib/supplierOrderInfo";
import { formatDateTime, formatEuro } from "@/lib/format";
import { approvalStatusLabels, approvalTypeLabels } from "@/lib/labels";
import type { ApprovalRequest } from "@/lib/types";

type ViewKey = "en_attente" | "traitees" | "toutes";

interface Decision {
  request: ApprovalRequest;
  approved: boolean;
}

export default function ApprovalsPage() {
  const { db, decideApproval } = useData();
  const { notify } = useToast();
  const [view, setView] = useState<ViewKey>("en_attente");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [reasonError, setReasonError] = useState(false);

  const requests = useMemo(() => {
    if (!db) return [];
    return db.approvalRequests
      .filter((r) =>
        view === "toutes"
          ? true
          : view === "en_attente"
            ? r.status === "en_attente"
            : r.status !== "en_attente",
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db, view]);

  const pagination = usePagination(requests);

  if (!db) return <LoadingState />;

  const pendingCount = db.approvalRequests.filter(
    (r) => r.status === "en_attente",
  ).length;
  const treatedCount = db.approvalRequests.length - pendingCount;

  const isCancellation = decision?.request.type === "annulation_commande";
  const decisionSupplierOrder = decision?.request.relatedSupplierOrderId
    ? db.supplierOrders.find((o) => o.id === decision.request.relatedSupplierOrderId)
    : undefined;
  const decisionSupplierInfo = decisionSupplierOrder
    ? buildSupplierOrderInfo(db, decisionSupplierOrder)
    : undefined;
  const decisionOrder = decision?.request.relatedOrderId
    ? db.orders.find((o) => o.id === decision.request.relatedOrderId)
    : undefined;
  const decisionOrderTotal = decisionOrder
    ? orderTotal(decisionOrder, linesOfOrder(db, decisionOrder.id))
    : 0;
  const decisionOrderPaid = decisionOrder ? orderPaid(decisionOrder, db.payments) : 0;

  const openDecision = (request: ApprovalRequest, approved: boolean) => {
    setReason("");
    setReasonError(false);
    // Préremplir la date d'arrivée estimée pour une commande fournisseur.
    if (request.relatedSupplierOrderId && approved) {
      const so = db.supplierOrders.find(
        (o) => o.id === request.relatedSupplierOrderId,
      );
      const info = so ? buildSupplierOrderInfo(db, so) : undefined;
      setExpectedAt(info?.estimatedArrival ? info.estimatedArrival.slice(0, 10) : "");
    } else {
      setExpectedAt("");
    }
    setDecision({ request, approved });
  };

  const confirmDecision = async () => {
    if (!decision) return;
    // Motif obligatoire pour toute décision sur une annulation (la même
    // règle est appliquée côté mutation : la protection n'est pas
    // seulement visuelle).
    if (isCancellation && !reason.trim()) {
      setReasonError(true);
      return;
    }
    try {
      await decideApproval(
        decision.request.id,
        decision.approved,
        "Responsable magasin",
        reason.trim() || undefined,
        decision.approved && expectedAt
          ? { expectedAt: new Date(`${expectedAt}T12:00:00`).toISOString() }
          : undefined,
      );
      notify(decision.approved ? "Demande validée." : "Demande refusée.");
      setDecision(null);
      setReason("");
    } catch (e) {
      notify(
        e instanceof BusinessError ? e.message : "Impossible de traiter la demande.",
        "error",
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Validations</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Toutes les décisions importantes attendent ici une validation
          humaine. Aucune action extérieure réelle n&apos;est exécutée dans cette
          version.
        </p>
      </div>

      <ViewTabs<ViewKey>
        ariaLabel="Filtrer les demandes"
        value={view}
        onChange={setView}
        tabs={[
          { key: "en_attente", label: "En attente de validation", count: pendingCount },
          { key: "traitees", label: "Traitées", count: treatedCount },
          { key: "toutes", label: "Toutes" },
        ]}
      />

      {requests.length === 0 ? (
        <EmptyState
          title={
            view === "en_attente"
              ? "Aucune demande en attente de validation"
              : "Aucune demande"
          }
          description="Les demandes créées depuis les commandes, les achats ou les relances apparaîtront ici."
          icon={CheckSquare}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {pagination.paged.map((request) => {
            const status = approvalStatusLabels[request.status];
            const order = db.orders.find((o) => o.id === request.relatedOrderId);
            const store = order
              ? db.stores.find((s) => s.id === order.storeId)
              : undefined;
            const customer = order
              ? db.customers.find((c) => c.id === order.customerId)
              : undefined;
            const supplierOrder = db.supplierOrders.find(
              (o) => o.id === request.relatedSupplierOrderId,
            );
            return (
              <div key={request.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{approvalTypeLabels[request.type]}</Badge>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {request.financialImpact && request.financialImpact > 0 ? (
                        <Badge tone="warning">
                          Impact : {formatEuro(request.financialImpact)} encaissés
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 font-semibold">{request.title}</p>
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                      {request.description}
                    </p>
                    <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      {order ? (
                        <div className="flex gap-1.5">
                          <dt style={{ color: "var(--muted)" }}>Commande :</dt>
                          <dd>
                            <Link
                              href={`/commandes/${order.id}`}
                              className="font-medium"
                              style={{ color: "var(--primary)" }}
                            >
                              {order.reference}
                            </Link>
                          </dd>
                        </div>
                      ) : null}
                      {store ? (
                        <div className="flex gap-1.5">
                          <dt style={{ color: "var(--muted)" }}>Magasin :</dt>
                          <dd>{store.name}</dd>
                        </div>
                      ) : null}
                      {customer ? (
                        <div className="flex gap-1.5">
                          <dt style={{ color: "var(--muted)" }}>Client :</dt>
                          <dd>{customer.name}</dd>
                        </div>
                      ) : null}
                      <div className="flex gap-1.5">
                        <dt style={{ color: "var(--muted)" }}>Demandé par :</dt>
                        <dd>{request.requestedBy ?? "—"}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt style={{ color: "var(--muted)" }}>Le :</dt>
                        <dd>{formatDateTime(request.createdAt)}</dd>
                      </div>
                      {request.status !== "en_attente" ? (
                        <div className="flex gap-1.5">
                          <dt style={{ color: "var(--muted)" }}>Traitée par :</dt>
                          <dd>
                            {request.decidedBy ?? "—"} · {formatDateTime(request.decidedAt)}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {supplierOrder ? (
                      <SupplierOrderInfoTable
                        info={buildSupplierOrderInfo(db, supplierOrder)}
                      />
                    ) : null}
                    {request.decisionReason ? (
                      <p className="mt-2 text-sm italic" style={{ color: "var(--muted)" }}>
                        Motif : {request.decisionReason}
                      </p>
                    ) : null}
                  </div>
                  {request.status === "en_attente" ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => openDecision(request, true)}
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openDecision(request, false)}
                      >
                        Refuser
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="card">
            <PaginationBar
              page={pagination.page}
              pageCount={pagination.pageCount}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          </div>
        </div>
      )}

      {/* Dialogue de décision — récapitulatif impossible à confondre */}
      {decision ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="decision-title"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDecision(null)}
            aria-hidden
          />
          <div className="card relative max-h-[90vh] w-full max-w-lg overflow-y-auto p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 id="decision-title" className="text-base font-semibold">
                {isCancellation
                  ? decision.approved
                    ? "Valider l'ANNULATION de cette commande ?"
                    : "Refuser l'annulation de cette commande ?"
                  : decision.approved
                    ? "Valider cette demande ?"
                    : "Refuser cette demande ?"}
              </h2>
              <button
                type="button"
                onClick={() => setDecision(null)}
                className="rounded p-1 transition hover:bg-black/5"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {decision.request.title} — aucune action extérieure réelle ne sera
              exécutée : seul le suivi interne sera mis à jour.
            </p>

            {/* Récapitulatif très visible pour une annulation */}
            {isCancellation && decisionOrder ? (
              <div
                className="mt-4 rounded-md border p-3"
                style={{ borderColor: "var(--danger)", background: "var(--danger-soft)" }}
              >
                <p
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"
                  style={{ color: "var(--danger)" }}
                >
                  <AlertTriangle size={14} aria-hidden />
                  Annulation de commande — vérifiez ces informations
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <dt style={{ color: "var(--muted)" }}>Commande</dt>
                  <dd className="font-semibold">{decisionOrder.reference}</dd>
                  <dt style={{ color: "var(--muted)" }}>Client</dt>
                  <dd className="font-semibold">
                    {db.customers.find((c) => c.id === decisionOrder.customerId)?.name ?? "—"}
                  </dd>
                  <dt style={{ color: "var(--muted)" }}>Magasin</dt>
                  <dd>
                    {db.stores.find((s) => s.id === decisionOrder.storeId)?.name ??
                      "Commande en ligne"}
                  </dd>
                  <dt style={{ color: "var(--muted)" }}>Total historique</dt>
                  <dd className="font-semibold">{formatEuro(decisionOrderTotal)}</dd>
                  <dt style={{ color: "var(--muted)" }}>Déjà encaissé</dt>
                  <dd className="font-semibold">{formatEuro(decisionOrderPaid)}</dd>
                  <dt style={{ color: "var(--muted)" }}>
                    À rembourser ou transformer en avoir
                  </dt>
                  <dd className="font-bold" style={{ color: "var(--danger)" }}>
                    {formatEuro(Math.max(0, decisionOrderPaid))}
                  </dd>
                </dl>
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  Le total historique et les règlements sont conservés. Aucun
                  remboursement réel n&apos;est effectué par l&apos;application.
                </p>
              </div>
            ) : null}

            {/* Récapitulatif commande fournisseur + date d'arrivée modifiable */}
            {decisionSupplierInfo ? (
              <>
                <SupplierOrderInfoTable info={decisionSupplierInfo} />
                {decision.approved ? (
                  <label className="mt-3 block">
                    <span className="field-label">
                      Date d&apos;arrivée estimée (modifiable avant validation)
                    </span>
                    <input
                      type="date"
                      className="field-input"
                      value={expectedAt}
                      onChange={(e) => setExpectedAt(e.target.value)}
                    />
                    {decisionSupplierInfo.estimatedArrivalComputed ? (
                      <span className="field-hint">
                        Proposée à partir du délai habituel du fournisseur.
                      </span>
                    ) : null}
                  </label>
                ) : null}
              </>
            ) : null}

            <label className="mt-4 block">
              <span className="field-label">
                Motif {isCancellation ? "(obligatoire)" : "(facultatif)"}
              </span>
              <textarea
                className="field-input"
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim()) setReasonError(false);
                }}
                aria-required={isCancellation}
                aria-invalid={reasonError}
                placeholder={
                  isCancellation
                    ? "Motif de la décision (obligatoire pour une annulation)…"
                    : decision.approved
                      ? "Commentaire éventuel…"
                      : "Pourquoi cette demande est-elle refusée ?"
                }
              />
              {reasonError ? (
                <span className="mt-1 block text-xs font-medium" style={{ color: "var(--danger)" }}>
                  Le motif est obligatoire pour valider ou refuser une annulation.
                </span>
              ) : null}
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDecision(null)}>
                Annuler
              </button>
              <button
                type="button"
                className={
                  decision.approved && !isCancellation ? "btn-primary" : "btn-danger"
                }
                onClick={confirmDecision}
                disabled={isCancellation && !reason.trim()}
              >
                {isCancellation && decision.approved
                  ? "Valider l'annulation"
                  : decision.approved
                    ? "Valider"
                    : "Refuser"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
