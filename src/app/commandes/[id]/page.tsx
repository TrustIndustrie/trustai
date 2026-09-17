"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Circle,
  MapPin,
  Megaphone,
  Plus,
  Truck,
} from "lucide-react";
import { useData, todayIso, BusinessError } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  lineTotal,
  linesOfOrder,
  orderPaid,
  orderPaymentStatus,
  orderRap,
  orderTotal,
  pendingCancellation,
} from "@/lib/derive";
import { formatDate, formatDateTime, formatEuro } from "@/lib/format";
import {
  acquisitionSourceLabels,
  approvalStatusLabels,
  approvalTypeLabels,
  deliveryStatusLabels,
  fulfillmentModeLabels,
  orderStatusLabels,
  originLabels,
  paymentMethodLabels,
  paymentStatusLabels,
  shipmentStatusLabels,
  transportModeLabels,
} from "@/lib/labels";
import { LineProcurementControl } from "@/components/LineProcurementControl";
import type { PaymentMethod } from "@/lib/types";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { db, addPayment, requestOrderCancellation, decideApproval } = useData();
  const { notify } = useToast();

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const [payMethod, setPayMethod] = useState<PaymentMethod>("carte_bancaire");
  const [payComment, setPayComment] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [approvalToDecide, setApprovalToDecide] = useState<{
    id: string;
    approved: boolean;
    title: string;
  } | null>(null);

  if (!db) return <LoadingState />;

  const order = db.orders.find((o) => o.id === params.id);
  if (!order) {
    return (
      <EmptyState
        title="Commande introuvable"
        description="Cette commande n'existe pas ou a été supprimée."
        action={
          <Link href="/commandes" className="btn-secondary">
            <ArrowLeft size={16} aria-hidden />
            Retour aux commandes
          </Link>
        }
      />
    );
  }

  const customer = db.customers.find((c) => c.id === order.customerId);
  const store = db.stores.find((s) => s.id === order.storeId);
  const salesperson = db.salespeople.find((s) => s.id === order.salespersonId);
  const lines = linesOfOrder(db, order.id);
  const payments = db.payments
    .filter((p) => p.orderId === order.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = orderTotal(order, lines);
  const paid = orderPaid(order, payments);
  const rap = orderRap(order, lines, payments);
  const paymentStatus = paymentStatusLabels[orderPaymentStatus(order, lines, payments)];
  const journey = db.acquisitionJourneys.find((j) => j.orderId === order.id);
  const activity = db.activityLog.filter((a) => a.orderId === order.id);
  const approvals = db.approvalRequests.filter((a) => a.relatedOrderId === order.id);
  const pendingApprovals = approvals.filter((a) => a.status === "en_attente");

  const lineIds = lines.map((l) => l.id);
  const shipments = db.shipments.filter((s) =>
    s.items.some((i) => i.orderLineId && lineIds.includes(i.orderLineId)),
  );

  const delivery = deliveryStatusLabels[order.deliveryStatus];
  const orderStatus = orderStatusLabels[order.status];
  const cancellationPending = pendingCancellation(db, order.id);
  // Le RAP conditionne l'ajout de règlement : commande soldée = pas de bouton.
  const canAddPayment = order.status === "ouverte" && rap > 0;

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(payAmount.replace(",", "."));
    if (Number.isNaN(amount) || amount <= 0) {
      notify("Le montant d'un règlement doit être strictement supérieur à zéro.", "error");
      return;
    }
    try {
      await addPayment(order.id, {
        amount,
        date: new Date(`${payDate}T12:00:00`).toISOString(),
        method: payMethod,
        comment: payComment.trim() || undefined,
      });
      setPayAmount("");
      setPayComment("");
      setShowPaymentForm(false);
      notify("Règlement enregistré, RAP mis à jour.");
    } catch (err) {
      // Règle métier violée (montant > RAP, commande soldée…) : rien n'est
      // enregistré, le message explique précisément le refus.
      notify(
        err instanceof BusinessError
          ? err.message
          : "Impossible d'enregistrer le règlement.",
        "error",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/commandes"
            className="mb-1 inline-flex items-center gap-1 text-sm font-medium"
            style={{ color: "var(--muted)" }}
          >
            <ArrowLeft size={14} aria-hidden />
            Commandes
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{order.reference}</h1>
            <Badge tone={orderStatus.tone}>{orderStatus.label}</Badge>
            <Badge tone={paymentStatus.tone}>{paymentStatus.label}</Badge>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {originLabels[order.origin]}
            {store ? ` — ${store.name}` : ""} · Commandée le {formatDate(order.orderedAt)}
            {salesperson ? ` · ${salesperson.name}` : ""}
          </p>
        </div>
        {order.status === "ouverte" ? (
          cancellationPending ? (
            <span
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--violet-soft)", color: "var(--violet)" }}
            >
              <Ban size={16} aria-hidden />
              Annulation demandée — en attente de validation
            </span>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmCancel(true)}
            >
              <Ban size={16} aria-hidden />
              Demander l&apos;annulation
            </button>
          )
        ) : null}
      </div>

      {order.status === "annulee" && paid > 0 ? (
        <div
          className="rounded-md border p-3 text-sm font-medium"
          style={{
            borderColor: "var(--warning)",
            background: "var(--warning-soft)",
            color: "var(--warning)",
          }}
          role="alert"
        >
          Remboursement ou avoir à traiter : {formatEuro(paid)} — la commande a
          été annulée après encaissement. Aucun remboursement réel n&apos;est
          effectué par l&apos;application.
        </div>
      ) : null}

      {/* Synthèse financière */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Total de la commande
          </p>
          <p className="mt-1 text-2xl font-semibold">{formatEuro(total)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Règlements encaissés
          </p>
          <p className="mt-1 text-2xl font-semibold">{formatEuro(paid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Reste à payer (RAP)
          </p>
          <p
            className="mt-1 text-2xl font-semibold"
            style={{ color: rap > 0 ? "var(--danger)" : "var(--success)" }}
          >
            {formatEuro(Math.max(0, rap))}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Articles et suivi fournisseur */}
          <section className="card">
            <h2 className="p-4 pb-0 text-sm font-semibold">
              Articles et suivi d&apos;approvisionnement
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th scope="col">Produit</th>
                    <th scope="col">Qté</th>
                    <th scope="col">Prix</th>
                    <th scope="col">Fournisseur</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Arrivée prévue</th>
                    <th scope="col">Dépôt</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const supplier = db.suppliers.find((s) => s.id === line.supplierId);
                    const altSupplier = db.suppliers.find((s) => s.id === line.altSupplierId);
                    const warehouse = db.warehouses.find(
                      (w) => w.id === line.destinationWarehouseId,
                    );
                    return (
                      <tr key={line.id}>
                        <td>
                          <p className="flex flex-wrap items-center gap-1.5 font-medium">
                            {line.productName}
                            {line.offCatalog ? (
                              <Badge tone="warning">Hors catalogue</Badge>
                            ) : null}
                          </p>
                          {line.variant ? (
                            <p className="text-xs" style={{ color: "var(--muted)" }}>
                              {line.variant}
                            </p>
                          ) : null}
                          {line.reference ? (
                            <p className="text-xs" style={{ color: "var(--muted)" }}>
                              Réf. {line.reference}
                            </p>
                          ) : null}
                          {line.comments ? (
                            <p className="mt-1 text-xs italic" style={{ color: "var(--muted)" }}>
                              {line.comments}
                            </p>
                          ) : null}
                        </td>
                        <td>{line.quantity}</td>
                        <td className="whitespace-nowrap">
                          {formatEuro(lineTotal(line))}
                          {line.discount > 0 ? (
                            <p className="text-xs" style={{ color: "var(--muted)" }}>
                              dont remise {formatEuro(line.discount)}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          {supplier?.name ?? "À déterminer"}
                          {altSupplier ? (
                            <p className="text-xs" style={{ color: "var(--muted)" }}>
                              Alt. : {altSupplier.name}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <LineProcurementControl
                            line={line}
                            orderCancelled={order.status === "annulee"}
                          />
                        </td>
                        <td className="whitespace-nowrap">{formatDate(line.expectedArrival)}</td>
                        <td>{warehouse?.name ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Parcours logistique */}
          <section className="card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Truck size={16} aria-hidden style={{ color: "var(--primary)" }} />
              Parcours logistique
            </h2>
            {shipments.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Aucun transport rattaché pour l&apos;instant.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-6">
                {shipments.map((shipment) => {
                  const shipmentStatus = shipmentStatusLabels[shipment.status];
                  return (
                    <div key={shipment.id}>
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{shipment.reference}</span>
                        <Badge tone={shipmentStatus.tone}>{shipmentStatus.label}</Badge>
                        <span style={{ color: "var(--muted)" }}>
                          {transportModeLabels[shipment.mode]}
                          {shipment.charterReference
                            ? ` · Affrètement ${shipment.charterReference}`
                            : ""}
                        </span>
                      </div>
                      <ol className="relative flex flex-col gap-0">
                        {[...shipment.legs]
                          .sort((a, b) => a.sequence - b.sequence)
                          .map((leg, i, arr) => {
                            const done = leg.status === "recu" || Boolean(leg.actualAt);
                            const legStatus = shipmentStatusLabels[leg.status];
                            return (
                              <li key={leg.id} className="relative flex gap-3 pb-5">
                                {i < arr.length - 1 ? (
                                  <span
                                    className="absolute left-[9px] top-6 h-full w-0.5"
                                    style={{ background: "var(--border)" }}
                                    aria-hidden
                                  />
                                ) : null}
                                {done ? (
                                  <CheckCircle2
                                    size={20}
                                    className="relative z-10 shrink-0"
                                    style={{ color: "var(--success)" }}
                                    aria-hidden
                                  />
                                ) : (
                                  <Circle
                                    size={20}
                                    className="relative z-10 shrink-0"
                                    style={{ color: "var(--muted)" }}
                                    aria-hidden
                                  />
                                )}
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">
                                    {leg.originLabel} → {leg.destinationLabel}
                                  </p>
                                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                                    {transportModeLabels[leg.mode]}
                                    {leg.carrier ? ` · ${leg.carrier}` : ""}
                                    {leg.actualAt
                                      ? ` · effectué le ${formatDate(leg.actualAt)}`
                                      : leg.plannedAt
                                        ? ` · prévu le ${formatDate(leg.plannedAt)}`
                                        : ""}
                                  </p>
                                  <div className="mt-1">
                                    <Badge tone={legStatus.tone}>{legStatus.label}</Badge>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                      </ol>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Règlements */}
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Règlements</h2>
              {canAddPayment ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPaymentForm((v) => !v)}
                >
                  <Plus size={16} aria-hidden />
                  Ajouter un règlement
                </button>
              ) : order.status === "ouverte" ? (
                <p className="text-sm font-medium" style={{ color: "var(--success)" }}>
                  Commande soldée — RAP de 0 €
                </p>
              ) : null}
            </div>

            {showPaymentForm && canAddPayment ? (
              <form
                onSubmit={handleAddPayment}
                className="mt-4 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <label htmlFor="newPayAmount" className="field-label">
                    Montant (€) *
                  </label>
                  <input
                    id="newPayAmount"
                    type="number"
                    step="0.01"
                    className="field-input"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="newPayDate" className="field-label">
                    Date *
                  </label>
                  <input
                    id="newPayDate"
                    type="date"
                    className="field-input"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="newPayMethod" className="field-label">
                    Moyen de paiement *
                  </label>
                  <select
                    id="newPayMethod"
                    className="field-input"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  >
                    {Object.entries(paymentMethodLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="newPayComment" className="field-label">
                    Commentaire
                  </label>
                  <input
                    id="newPayComment"
                    className="field-input"
                    value={payComment}
                    onChange={(e) => setPayComment(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                  <button type="submit" className="btn-primary">
                    Enregistrer le règlement
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowPaymentForm(false)}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            ) : null}

            {payments.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Aucun règlement enregistré.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Montant</th>
                      <th scope="col">Moyen</th>
                      <th scope="col">Encaissé par</th>
                      <th scope="col">Commentaire</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => {
                      const cashier = db.salespeople.find(
                        (s) => s.id === payment.salespersonId,
                      );
                      return (
                        <tr key={payment.id}>
                          <td className="whitespace-nowrap">{formatDate(payment.date)}</td>
                          <td className="whitespace-nowrap font-medium">
                            {formatEuro(payment.amount)}
                          </td>
                          <td>{paymentMethodLabels[payment.method]}</td>
                          <td>{cashier?.name ?? "—"}</td>
                          <td style={{ color: "var(--muted)" }}>{payment.comment ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Historique */}
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Historique des actions</h2>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Aucune action enregistrée pour cette commande.
              </p>
            ) : (
              <ol className="mt-3 flex flex-col gap-3">
                {activity.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-md border p-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <p className="text-sm font-medium">{entry.action}</p>
                    {entry.details ? (
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        {entry.details}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      {entry.actor} · {formatDateTime(entry.at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          {/* Client */}
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Client</h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt style={{ color: "var(--muted)" }}>Nom</dt>
                <dd className="font-medium">{customer?.name ?? "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--muted)" }}>Téléphone</dt>
                <dd>{customer?.phone ?? "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--muted)" }}>E-mail</dt>
                <dd>{customer?.email ?? "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--muted)" }}>Adresse</dt>
                <dd>
                  {customer?.address
                    ? `${customer.address}${customer.postalCode || customer.city ? `, ${customer.postalCode ?? ""} ${customer.city ?? ""}` : ""}`
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>

          {/* Livraison / retrait */}
          <section className="card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MapPin size={16} aria-hidden style={{ color: "var(--primary)" }} />
              Livraison ou retrait
            </h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt style={{ color: "var(--muted)" }}>Mode de remise</dt>
                <dd className="font-medium">{fulfillmentModeLabels[order.fulfillmentMode]}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--muted)" }}>Statut</dt>
                <dd className="mt-0.5">
                  <Badge tone={delivery.tone}>{delivery.label}</Badge>
                </dd>
              </div>
              {order.fulfillmentLocationLabel ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>Lieu</dt>
                  <dd>{order.fulfillmentLocationLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt style={{ color: "var(--muted)" }}>Date souhaitée</dt>
                <dd>{formatDate(order.desiredAt)}</dd>
              </div>
              {order.deliveryFee > 0 ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>Frais de livraison</dt>
                  <dd>{formatEuro(order.deliveryFee)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Acquisition marketing */}
          <section className="card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone size={16} aria-hidden style={{ color: "var(--primary)" }} />
              Acquisition marketing
            </h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt style={{ color: "var(--muted)" }}>Source</dt>
                <dd className="font-medium">
                  {order.acquisitionSource
                    ? acquisitionSourceLabels[order.acquisitionSource]
                    : "Non renseignée"}
                </dd>
              </div>
              {journey?.landingPage ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>Première page visitée</dt>
                  <dd className="break-all">{journey.landingPage}</dd>
                </div>
              ) : null}
              {journey?.utmSource ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>UTM</dt>
                  <dd>
                    {journey.utmSource} / {journey.utmMedium ?? "—"} /{" "}
                    {journey.utmCampaign ?? "—"}
                  </dd>
                </div>
              ) : null}
              {journey?.firstVisitAt ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>Première visite</dt>
                  <dd>{formatDate(journey.firstVisitAt)}</dd>
                </div>
              ) : null}
              {journey?.daysToConversion !== undefined ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>Délai de conversion</dt>
                  <dd>{journey.daysToConversion} jour(s)</dd>
                </div>
              ) : null}
              {journey?.newCustomer !== undefined ? (
                <div>
                  <dt style={{ color: "var(--muted)" }}>Type de client</dt>
                  <dd>{journey.newCustomer ? "Nouveau client" : "Client récurrent"}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Décisions en attente */}
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Décisions en attente</h2>
            {pendingApprovals.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Aucune validation en attente pour cette commande.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {pendingApprovals.map((approval) => {
                  const status = approvalStatusLabels[approval.status];
                  return (
                    <li
                      key={approval.id}
                      className="rounded-md border p-3"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                          {approvalTypeLabels[approval.type]}
                        </p>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="mt-1 text-sm font-medium">{approval.title}</p>
                      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                        {approval.description}
                      </p>
                      {approval.type === "annulation_commande" ? (
                        // Une annulation exige un motif et un récapitulatif
                        // financier : elle se traite dans la page Validations.
                        <div className="mt-3">
                          <Link
                            href="/validations"
                            className="btn-secondary px-3 py-1.5 text-xs"
                          >
                            Traiter dans Validations (motif obligatoire)
                          </Link>
                        </div>
                      ) : (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            className="btn-primary px-3 py-1.5 text-xs"
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
                            className="btn-secondary px-3 py-1.5 text-xs"
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
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {order.notes ? (
            <section className="card p-4">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                {order.notes}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Demander l'annulation de la commande ?"
        description={`L'annulation de ${order.reference} est une décision importante : une demande de validation sera créée et devra être approuvée par un humain.`}
        confirmLabel="Créer la demande"
        danger
        onConfirm={async () => {
          try {
            await requestOrderCancellation(order.id);
            notify("Demande d'annulation créée, en attente de validation.");
          } catch (err) {
            notify(
              err instanceof BusinessError
                ? err.message
                : "Impossible de créer la demande.",
              "error",
            );
          }
          setConfirmCancel(false);
        }}
        onCancel={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        open={approvalToDecide !== null}
        title={
          approvalToDecide?.approved
            ? "Valider cette décision ?"
            : "Refuser cette décision ?"
        }
        description={`${approvalToDecide?.title ?? ""} — aucune action extérieure réelle ne sera exécutée : seul le suivi interne sera mis à jour.`}
        confirmLabel={approvalToDecide?.approved ? "Valider" : "Refuser"}
        danger={!approvalToDecide?.approved}
        onConfirm={async () => {
          if (approvalToDecide) {
            try {
              await decideApproval(
                approvalToDecide.id,
                approvalToDecide.approved,
                "Responsable magasin",
              );
              notify(
                approvalToDecide.approved ? "Demande validée." : "Demande refusée.",
              );
            } catch (err) {
              notify(
                err instanceof BusinessError
                  ? err.message
                  : "Impossible de traiter la demande.",
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
