"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import { productCategoryLabels } from "@/lib/labels";
import { formatEuro } from "@/lib/format";
import type {
  Database,
  Product,
  ProductCategory,
  ProductVariant,
} from "@/lib/types";

export interface ProductSelection {
  product: Product;
  variant: ProductVariant;
  primarySupplierId?: string;
  altSupplierId?: string;
}

interface VariantOption {
  variant: ProductVariant;
  supplierName?: string;
  altNames: string[];
  primarySupplierId?: string;
  altSupplierId?: string;
}

interface ProductOption {
  product: Product;
  variants: VariantOption[];
  priceMin: number;
  priceMax: number;
}

/**
 * Combobox accessible de sélection produit + variante depuis le catalogue,
 * en DEUX étapes : d'abord le produit (une ligne par produit, nombre de
 * variantes et fourchette de prix), puis le choix explicite de la variante
 * (couleur, dimensions…). Un produit à variante unique se sélectionne en un
 * clic. Recherche par nom, variante, SKU ou référence fournisseur, filtre
 * par catégorie, navigation clavier (flèches, Entrée, Échap, retour).
 */
export function ProductCombobox({
  db,
  onSelect,
  placeholder = "Rechercher un produit, un SKU…",
}: {
  db: Database;
  onSelect: (selection: ProductSelection) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ProductCategory>("all");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // Étape 2 : produit dont on choisit la variante (null = étape 1).
  const [pickingFor, setPickingFor] = useState<ProductOption | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const options = useMemo<ProductOption[]>(() => {
    const q = query.trim().toLowerCase();
    const result: ProductOption[] = [];
    for (const product of db.products) {
      if (!product.active) continue;
      if (category !== "all" && product.category !== category) continue;
      const variants = db.productVariants
        .filter((v) => v.productId === product.id)
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      if (variants.length === 0) continue;

      const variantOptions: VariantOption[] = variants.map((variant) => {
        const links = db.productSuppliers
          .filter((ps) => ps.variantId === variant.id)
          .sort((a, b) => a.priority - b.priority);
        const primary = links.find((l) => l.isPrimary) ?? links[0];
        const alts = links.filter((l) => l !== primary);
        return {
          variant,
          supplierName: primary
            ? db.suppliers.find((s) => s.id === primary.supplierId)?.name
            : undefined,
          altNames: alts
            .map((l) => db.suppliers.find((s) => s.id === l.supplierId)?.name)
            .filter((n): n is string => Boolean(n)),
          primarySupplierId: primary?.supplierId,
          altSupplierId: alts[0]?.supplierId,
        };
      });

      if (q) {
        const haystack = [
          product.title,
          ...variantOptions.flatMap((o) => [
            o.variant.name,
            o.variant.sku,
            ...db.productSuppliers
              .filter((ps) => ps.variantId === o.variant.id)
              .map((ps) => ps.supplierReference ?? ""),
          ]),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }

      const prices = variantOptions.map((o) => o.variant.price);
      result.push({
        product,
        variants: variantOptions,
        priceMin: Math.min(...prices),
        priceMax: Math.max(...prices),
      });
    }
    return result.slice(0, 30);
  }, [db, query, category]);

  useEffect(() => {
    setHighlighted(0);
    setPickingFor(null);
  }, [query, category, open]);

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      // Un élément déjà détaché du document vient forcément de l'INTÉRIEUR
      // du composant : le passage produit → variantes remplace la ligne
      // cliquée avant que l'événement n'atteigne document (rendu synchrone
      // React sur les événements de saisie), et `contains` répondrait
      // faussement « extérieur », refermant la liste.
      if (!target || !target.isConnected) return;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selectVariant = (product: Product, option: VariantOption) => {
    onSelect({
      product,
      variant: option.variant,
      primarySupplierId: option.primarySupplierId,
      altSupplierId: option.altSupplierId,
    });
    setQuery("");
    setPickingFor(null);
    setOpen(false);
  };

  const selectProduct = (option: ProductOption) => {
    if (option.variants.length === 1) {
      // Variante unique : pas de 2e étape inutile.
      selectVariant(option.product, option.variants[0]);
    } else {
      setPickingFor(option);
      setHighlighted(0);
    }
  };

  const currentLength = pickingFor ? pickingFor.variants.length : options.length;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, currentLength - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (pickingFor) {
        const option = pickingFor.variants[highlighted];
        if (option) selectVariant(pickingFor.product, option);
      } else if (options[highlighted]) {
        selectProduct(options[highlighted]);
      }
    } else if (e.key === "Escape") {
      if (pickingFor) {
        setPickingFor(null);
        setHighlighted(0);
      } else {
        setOpen(false);
      }
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted)" }}
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-label="Rechercher un produit du catalogue"
            className="field-input pl-9 pr-9"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          <ChevronsUpDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted)" }}
            aria-hidden
          />
        </div>
        <label>
          <span className="sr-only">Catégorie</span>
          <select
            className="field-input w-full sm:w-44"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as "all" | ProductCategory);
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            <option value="all">Toutes catégories</option>
            {Object.entries(productCategoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={
            pickingFor
              ? `Variantes de ${pickingFor.product.title}`
              : "Produits du catalogue"
          }
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border shadow-lg"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {pickingFor ? (
            <>
              <li
                role="presentation"
                className="sticky top-0 border-b px-3 py-2"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left text-sm font-medium"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setPickingFor(null);
                    setHighlighted(0);
                  }}
                >
                  <ArrowLeft size={14} aria-hidden />
                  {pickingFor.product.title}
                  <span className="font-normal" style={{ color: "var(--muted)" }}>
                    — choisissez la variante
                  </span>
                </button>
              </li>
              {pickingFor.variants.map((option, index) => (
                <li
                  key={option.variant.id}
                  role="option"
                  aria-selected={index === highlighted}
                  className="cursor-pointer border-b px-3 py-2.5 last:border-b-0"
                  style={{
                    borderColor: "var(--border)",
                    background: index === highlighted ? "var(--primary-soft)" : undefined,
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectVariant(pickingFor.product, option);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{option.variant.name}</p>
                    <p className="whitespace-nowrap text-sm font-semibold">
                      {formatEuro(option.variant.price)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    SKU {option.variant.sku}
                    {option.variant.dimensions ? ` · ${option.variant.dimensions}` : ""}
                    {option.supplierName ? ` · Fournisseur : ${option.supplierName}` : ""}
                    {option.altNames.length > 0 ? ` (alt. ${option.altNames.join(", ")})` : ""}
                  </p>
                </li>
              ))}
            </>
          ) : options.length === 0 ? (
            <li className="px-3 py-3 text-sm" style={{ color: "var(--muted)" }} role="presentation">
              Aucun produit trouvé. Utilisez « Produit hors catalogue » pour une
              saisie libre.
            </li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.product.id}
                role="option"
                aria-selected={index === highlighted}
                className="cursor-pointer border-b px-3 py-2.5 last:border-b-0"
                style={{
                  borderColor: "var(--border)",
                  background: index === highlighted ? "var(--primary-soft)" : undefined,
                }}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectProduct(option);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{option.product.title}</p>
                  <p
                    className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold"
                  >
                    {option.priceMin === option.priceMax
                      ? formatEuro(option.priceMin)
                      : `${formatEuro(option.priceMin)} – ${formatEuro(option.priceMax)}`}
                    {option.variants.length > 1 ? (
                      <ChevronRight size={14} aria-hidden style={{ color: "var(--muted)" }} />
                    ) : null}
                  </p>
                </div>
                <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                  {productCategoryLabels[option.product.category]}
                  {option.variants.length > 1
                    ? ` · ${option.variants.length} variantes (couleur, dimensions…)`
                    : ` · ${option.variants[0].variant.name} · SKU ${option.variants[0].variant.sku}`}
                </p>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
