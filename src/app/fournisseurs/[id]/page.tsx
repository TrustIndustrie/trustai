"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/format";
import {
  procurementStatusLabels,
  supplierChannelLabels,
  supplierLogisticsLabels,
  supplierOrderStatusLabels,
} from "@/lib/labels";

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const { db } = useData();

  if (!db) return <LoadingState />;

  const supplier = db.suppliers.find((s) => s.id === params.id);
  if (!supplier) {
    return (
      <EmptyState
        title="Fournisseur introuvable"
        action={
          <Link href="/fournisseurs" className="btn-secondary">
            <ArrowLeft size={16} aria-hidden />
            Retour aux fournisseurs
          </Link>
        }
      />
    );
  }

  const products = db.productSuppliers
    .filter((p) => p.supplierId === supplier.id)
    .sort((a, b) => a.priority - b.priority);
  const supplierOrders = db.supplierOrders
    .filter((o) => o.supplierId === supplier.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lines = db.orderLines.filter(
    (l) => l.supplierId === supplier.id || l.altSupplierId === supplier.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/fournisseurs"
          className="mb-1 inline-flex items-center gap-1 text-sm font-medium"
          style={{ color: "var(--muted)" }}
        >
          <ArrowLeft size={14} aria-hidden />
          Fournisseurs
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{supplier.name}</h1>
          <Badge tone={supplier.active ? "success" : "neutral"}>
            {supplier.active ? "Actif" : "Inactif"}
          </Badge>
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {supplier.specialties.join(" · ")}
          {supplier.country ? ` — ${supplier.country}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Coordonnées et fonctionnement</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div>
              <dt style={{ color: "var(--muted)" }}>Téléphone</dt>
              <dd>{supplier.phone ?? "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Site internet</dt>
              <dd>
                {supplier.website ? (
                  <a
                    href={supplier.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-medium"
                    style={{ color: "var(--primary)" }}
                  >
                    {supplier.website}
                    <ExternalLink size={12} aria-hidden />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Canal de commande</dt>
              <dd>{supplierChannelLabels[supplier.orderChannel]}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Consultation du stock</dt>
              <dd>
                {supplier.stockUrl ? (
                  <a
                    href={supplier.stockUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-medium"
                    style={{ color: "var(--primary)" }}
                  >
                    Lien stock
                    <ExternalLink size={12} aria-hidden />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Jour habituel de commande</dt>
              <dd>{supplier.usualOrderDay ?? "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Jours de retrait possibles</dt>
              <dd>{supplier.pickupDays.length > 0 ? supplier.pickupDays.join(", ") : "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Délai habituel</dt>
              <dd>{supplier.leadTimeDays ? `${supplier.leadTimeDays} jours` : "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Logistique</dt>
              <dd>{supplierLogisticsLabels[supplier.logistics]}</dd>
            </div>
            {supplier.comments ? (
              <div>
                <dt style={{ color: "var(--muted)" }}>Commentaires</dt>
                <dd>{supplier.comments}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="card p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Produits associés</h2>
          {products.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Aucun produit référencé chez ce fournisseur pour l&apos;instant.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th scope="col">Produit</th>
                    <th scope="col">Référence fournisseur</th>
                    <th scope="col">Délai</th>
                    <th scope="col">Rôle</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <p className="font-medium">{product.productName}</p>
                        {product.variant ? (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            {product.variant}
                          </p>
                        ) : null}
                      </td>
                      <td>{product.supplierReference ?? "—"}</td>
                      <td>{product.leadTimeDays ? `${product.leadTimeDays} j` : "—"}</td>
                      <td>
                        <Badge tone={product.isPrimary ? "info" : "neutral"}>
                          {product.isPrimary
                            ? "Fournisseur principal"
                            : `Alternatif (priorité ${product.priority})`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="mt-6 text-sm font-semibold">Commandes fournisseur</h2>
          {supplierOrders.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Aucune commande passée chez ce fournisseur.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th scope="col">Référence</th>
                    <th scope="col">Articles</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Créée le</th>
                    <th scope="col">Attendue le</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierOrders.map((so) => {
                    const status = supplierOrderStatusLabels[so.status];
                    return (
                      <tr key={so.id}>
                        <td className="font-medium">{so.reference}</td>
                        <td>{so.lines.reduce((s, l) => s + l.quantity, 0)}</td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td className="whitespace-nowrap">{formatDate(so.createdAt)}</td>
                        <td className="whitespace-nowrap">{formatDate(so.expectedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="mt-6 text-sm font-semibold">
            Articles clients suivis chez ce fournisseur
          </h2>
          {lines.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Aucun article client en cours chez ce fournisseur.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {lines.map((line) => {
                const order = db.orders.find((o) => o.id === line.orderId);
                const status = procurementStatusLabels[line.procurementStatus];
                return (
                  <li key={line.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {line.quantity} × {line.productName}
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {line.altSupplierId === supplier.id ? (
                      <Badge tone="neutral">Alternatif</Badge>
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
          )}
        </section>
      </div>
    </div>
  );
}
