"use client";

import { useMemo, useState } from "react";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaginationBar, usePagination } from "@/components/ui/Pagination";
import { formatDate, formatEuro } from "@/lib/format";
import { productCategoryLabels, productSourceLabels } from "@/lib/labels";
import { VariantLogisticsDialog } from "@/components/VariantLogisticsDialog";
import type { ProductCategory, ProductVariant } from "@/lib/types";

/**
 * Résumé lisible du référentiel logistique d'une variante : ce qui est
 * renseigné, sans jamais inventer une valeur absente.
 */
function describeLogistics(variant: ProductVariant): string {
  const l = variant.logistics;
  if (!l) return "· logistique à renseigner";
  const parts: string[] = [];
  if (l.weightGrams) parts.push(`${(l.weightGrams / 1000).toFixed(1)} kg`);
  if (l.volumeCm3) parts.push(`${(l.volumeCm3 / 1_000_000).toFixed(2)} m³`);
  if (l.packageCount) parts.push(`${l.packageCount} colis`);
  if (l.recommendedHandlers) parts.push(`${l.recommendedHandlers} livreur(s)`);
  if (l.fragile) parts.push("fragile");
  if (l.requiresInstallation) parts.push("installation");
  return parts.length > 0 ? `· ${parts.join(" · ")}` : "· logistique à renseigner";
}

export default function CataloguePage() {
  const { db, mode, refresh } = useData();
  const { profile } = useSession();
  const { notify } = useToast();
  const [variantToEdit, setVariantToEdit] = useState<ProductVariant | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | ProductCategory>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "actifs" | "inactifs">("actifs");
  const [syncing, setSyncing] = useState(false);
  const [syncedCount, setSyncedCount] = useState(0);

  const canSync =
    mode === "connected" && profile !== null && hasPermission(profile.role, "gerer_catalogue");

  // Référentiel logistique : écriture par fonction serveur uniquement.
  const canEditLogistics =
    mode === "demo" ||
    (profile !== null && hasPermission(profile.role, "gerer_referentiel_logistique"));

  // Synchronisation page par page (100 produits par requête) : chaque appel
  // serveur reste court, donc jamais de timeout, et la progression s'affiche
  // au fil de l'import. Idempotent : relancer reprend sans créer de doublon.
  const syncFromShopify = async () => {
    setSyncing(true);
    setSyncedCount(0);
    let cursor: string | null = null;
    let startedAt: string | null = null;
    let products = 0;
    let variants = 0;
    let deactivated = 0;
    try {
      for (let page = 0; page < 500; page++) {
        const response: Response = await fetch("/api/shopify/sync-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor, startedAt, totals: { products, variants } }),
        });
        let body: {
          error?: string;
          products?: number;
          variants?: number;
          deactivated?: number;
          nextCursor?: string | null;
          startedAt?: string;
        } | null = null;
        try {
          body = await response.json();
        } catch {
          // réponse non JSON (coupure serveur) : traitée comme une erreur.
        }
        if (!response.ok || !body) {
          notify(
            body?.error ??
              `Synchronisation interrompue (HTTP ${response.status}). Relancez-la : elle reprend sans créer de doublon.`,
            "error",
          );
          if (products > 0) await refresh();
          setSyncing(false);
          return;
        }
        products += body.products ?? 0;
        variants += body.variants ?? 0;
        deactivated = body.deactivated ?? 0;
        startedAt = body.startedAt ?? startedAt;
        cursor = body.nextCursor ?? null;
        setSyncedCount(products);
        if (!cursor) break;
      }
      notify(
        `Catalogue synchronisé : ${products} produit(s), ${variants} variante(s)${deactivated > 0 ? ` ; ${deactivated} produit(s) désactivé(s) (absents de la boutique)` : ""}.`,
      );
      await refresh();
    } catch {
      notify(
        "Erreur réseau pendant la synchronisation. Relancez-la : elle reprend sans créer de doublon.",
        "error",
      );
      if (products > 0) await refresh();
    }
    setSyncing(false);
  };

  const rows = useMemo(() => {
    if (!db) return [];
    const q = search.trim().toLowerCase();
    return db.products
      .filter((p) => category === "all" || p.category === category)
      .filter((p) =>
        activeFilter === "all" ? true : activeFilter === "actifs" ? p.active : !p.active,
      )
      .map((product) => {
        const variants = db.productVariants.filter((v) => v.productId === product.id);
        return { product, variants };
      })
      .filter(({ product, variants }) => {
        if (!q) return true;
        const links = db.productSuppliers.filter((ps) => ps.productId === product.id);
        const haystack = [
          product.title,
          ...variants.map((v) => `${v.name} ${v.sku}`),
          ...links.map((l) => l.supplierReference ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => a.product.title.localeCompare(b.product.title));
  }, [db, search, category, activeFilter]);

  const pagination = usePagination(rows);

  if (!db) return <LoadingState />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Catalogue</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {mode === "connected"
              ? "Catalogue centralisé. Les produits Shopify arrivent automatiquement par webhook ; la synchronisation manuelle importe tout le catalogue."
              : "Catalogue centralisé des produits et variantes. La synchronisation Shopify est simulée en mode démonstration."}
          </p>
        </div>
        {canSync ? (
          <button
            type="button"
            className="btn-primary"
            onClick={syncFromShopify}
            disabled={syncing}
          >
            <RefreshCw size={16} aria-hidden className={syncing ? "animate-spin" : undefined} />
            {syncing
              ? syncedCount > 0
                ? `Synchronisation… ${syncedCount} produit(s)`
                : "Synchronisation…"
              : "Synchroniser depuis Shopify"}
          </button>
        ) : null}
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2">
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
            placeholder="Rechercher par nom, SKU, référence fournisseur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Catégorie</span>
          <select
            className="field-input"
            value={category}
            onChange={(e) => setCategory(e.target.value as "all" | ProductCategory)}
          >
            <option value="all">Toutes catégories</option>
            {Object.entries(productCategoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Actif / inactif</span>
          <select
            className="field-input"
            value={activeFilter}
            onChange={(e) =>
              setActiveFilter(e.target.value as "all" | "actifs" | "inactifs")
            }
          >
            <option value="actifs">Produits actifs</option>
            <option value="inactifs">Produits inactifs</option>
            <option value="all">Tous</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Aucun produit trouvé"
          description="Modifiez la recherche ou les filtres."
          icon={BookOpen}
        />
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Produit</th>
                  <th scope="col">Catégorie</th>
                  <th scope="col">Variantes</th>
                  <th scope="col">Fournisseur principal</th>
                  <th scope="col">Origine</th>
                  <th scope="col">Synchronisation</th>
                </tr>
              </thead>
              <tbody>
                {pagination.paged.map(({ product, variants }) => {
                  const source = productSourceLabels[product.source];
                  const links = db.productSuppliers
                    .filter((ps) => ps.productId === product.id)
                    .sort((a, b) => a.priority - b.priority);
                  const primary = links.find((l) => l.isPrimary) ?? links[0];
                  const primaryName = primary
                    ? db.suppliers.find((s) => s.id === primary.supplierId)?.name
                    : undefined;
                  const altNames = links
                    .filter((l) => l !== primary)
                    .map((l) => db.suppliers.find((s) => s.id === l.supplierId)?.name)
                    .filter(Boolean);
                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{product.title}</p>
                          {!product.active ? <Badge tone="neutral">Inactif</Badge> : null}
                        </div>
                        {product.shortDescription ? (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            {product.shortDescription}
                          </p>
                        ) : null}
                      </td>
                      <td>{productCategoryLabels[product.category]}</td>
                      <td>
                        <ul className="flex flex-col gap-1">
                          {variants.map((v) => (
                            <li key={v.id} className="text-sm">
                              <span className="font-medium">{v.name}</span>{" "}
                              <span style={{ color: "var(--muted)" }}>
                                · {v.sku} · {formatEuro(v.price)}
                                {v.dimensions ? ` · ${v.dimensions}` : ""}
                              </span>
                              <span className="ml-1 inline-flex items-center gap-1.5">
                                <span className="text-xs" style={{ color: "var(--muted)" }}>
                                  {describeLogistics(v)}
                                </span>
                                {canEditLogistics ? (
                                  <button
                                    type="button"
                                    className="text-xs underline"
                                    style={{ color: "var(--primary)" }}
                                    onClick={() => setVariantToEdit(v)}
                                  >
                                    Logistique
                                  </button>
                                ) : null}
                              </span>
                            </li>
                          ))}
                          {variants.length === 0 ? (
                            <li className="text-sm" style={{ color: "var(--muted)" }}>
                              Aucune variante
                            </li>
                          ) : null}
                        </ul>
                      </td>
                      <td>
                        {primaryName ?? "—"}
                        {altNames.length > 0 ? (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            Alt. : {altNames.join(", ")}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={source.tone}>{source.label}</Badge>
                      </td>
                      <td>
                        {product.source === "shopify" ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-sm"
                            style={{ color: "var(--muted)" }}
                          >
                            <RefreshCw size={13} aria-hidden />
                            {product.lastSyncedAt
                              ? `Synchronisé le ${formatDate(product.lastSyncedAt)}${mode === "demo" ? " (simulation)" : ""}`
                              : "Jamais synchronisé"}
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: "var(--muted)" }}>
                            Saisie manuelle
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {variantToEdit ? (
        <VariantLogisticsDialog
          variant={variantToEdit}
          onClose={() => setVariantToEdit(null)}
        />
      ) : null}
    </div>
  );
}
