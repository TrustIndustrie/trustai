"use client";

import Link from "next/link";
import { useState } from "react";
import { PhoneOutgoing } from "lucide-react";
import { useData, BusinessError } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { PaginationBar, usePagination } from "@/components/ui/Pagination";
import { computeReminders } from "@/lib/derive";
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  nextMonday,
} from "@/lib/format";
import { procurementStatusLabels } from "@/lib/labels";

type ViewKey = "dues" | "programmees" | "historique";

export default function RemindersPage() {
  const { db, markReminderDone } = useData();
  const { notify } = useToast();
  const [view, setView] = useState<ViewKey>("dues");

  const reminders = db ? computeReminders(db) : [];
  const due = reminders.filter((r) => r.due);
  const scheduled = reminders.filter((r) => !r.due);
  const history = db
    ? db.activityLog.filter((a) => a.action === "Relance fournisseur effectuée")
    : [];
  const historyPagination = usePagination(history);

  if (!db) return <LoadingState />;

  const shown = view === "dues" ? due : view === "programmees" ? scheduled : [];

  const doReminder = async (lineId: string, outcome: "indisponible" | "disponible") => {
    try {
      await markReminderDone(lineId, outcome);
      notify(
        outcome === "indisponible"
          ? "Relance enregistrée — prochaine relance programmée lundi prochain."
          : "Relance enregistrée — article disponible, proposition de commande créée (à valider dans Achats).",
      );
    } catch (e) {
      notify(
        e instanceof BusinessError ? e.message : "Impossible d'enregistrer la relance.",
        "error",
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Relances du lundi</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Le lundi est le jour des commandes et relances fournisseurs. Prochain
          lundi : {formatDateLong(nextMonday())}. Aucun message WhatsApp réel
          n&apos;est envoyé dans cette version.
        </p>
      </div>

      <ViewTabs<ViewKey>
        ariaLabel="Filtrer les relances"
        value={view}
        onChange={setView}
        tabs={[
          { key: "dues", label: "À relancer", count: due.length },
          { key: "programmees", label: "Programmées", count: scheduled.length },
          { key: "historique", label: "Historique", count: history.length },
        ]}
      />

      {view === "historique" ? (
        history.length === 0 ? (
          <EmptyState
            title="Aucune relance effectuée pour l'instant"
            icon={PhoneOutgoing}
          />
        ) : (
          <div className="card">
            <ol className="flex flex-col">
              {historyPagination.paged.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b p-3 last:border-b-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <p className="text-sm">{entry.details}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {entry.actor} · {formatDateTime(entry.at)}
                    {entry.orderId ? (
                      <>
                        {" · "}
                        <Link
                          href={`/commandes/${entry.orderId}`}
                          className="font-medium"
                          style={{ color: "var(--primary)" }}
                        >
                          Voir la commande
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ol>
            <PaginationBar
              page={historyPagination.page}
              pageCount={historyPagination.pageCount}
              pageSize={historyPagination.pageSize}
              total={historyPagination.total}
              onPageChange={historyPagination.setPage}
              onPageSizeChange={historyPagination.setPageSize}
            />
          </div>
        )
      ) : shown.length === 0 ? (
        <EmptyState
          title={
            view === "dues"
              ? "Aucune relance due"
              : "Aucune relance programmée"
          }
          description={
            view === "dues"
              ? "Les articles à commander ou indisponibles dont la relance est due apparaîtront ici."
              : "Les relances déjà programmées pour un prochain lundi apparaîtront ici."
          }
          icon={PhoneOutgoing}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map(({ line, order, overdueDays }) => {
            const supplier = db.suppliers.find((s) => s.id === line.supplierId);
            const customer = db.customers.find((c) => c.id === order.customerId);
            const status = procurementStatusLabels[line.procurementStatus];
            const message = `Bonjour${supplier ? ` ${supplier.name}` : ""}, avez-vous du stock sur « ${line.productName}${line.variant ? ` — ${line.variant}` : ""} »${line.reference ? ` (réf. ${line.reference})` : ""} ? Il nous en faudrait ${line.quantity} pour une commande client. Merci !`;
            return (
              <div key={line.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        {line.quantity} × {line.productName}
                        {line.variant ? ` — ${line.variant}` : ""}
                      </p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {overdueDays > 0 ? (
                        <Badge tone="danger">Retard de {overdueDays} j</Badge>
                      ) : null}
                    </div>
                    <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div className="flex gap-1.5">
                        <dt style={{ color: "var(--muted)" }}>Fournisseur :</dt>
                        <dd className="font-medium">
                          {supplier?.name ?? "À déterminer"}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt style={{ color: "var(--muted)" }}>Client :</dt>
                        <dd>
                          {customer?.name ?? "—"}{" "}
                          <Link
                            href={`/commandes/${order.id}`}
                            className="font-medium"
                            style={{ color: "var(--primary)" }}
                          >
                            ({order.reference})
                          </Link>
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt style={{ color: "var(--muted)" }}>Dernière relance :</dt>
                        <dd>{formatDate(line.lastReminderAt)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt style={{ color: "var(--muted)" }}>Prochain lundi :</dt>
                        <dd>{formatDate(line.nextReminderAt ?? nextMonday())}</dd>
                      </div>
                    </dl>
                    <div
                      className="mt-3 rounded-md border p-3 text-sm"
                      style={{
                        borderColor: "var(--border)",
                        background: "var(--surface-muted)",
                      }}
                    >
                      <p className="mb-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                        Proposition de message (à envoyer manuellement)
                      </p>
                      {message}
                    </div>
                  </div>
                </div>
                {view === "dues" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => doReminder(line.id, "indisponible")}
                    >
                      Relance faite — toujours indisponible
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => doReminder(line.id, "disponible")}
                    >
                      Relance faite — article disponible
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
