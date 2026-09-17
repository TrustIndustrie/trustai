"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZES = [25, 50] as const;

/**
 * Hook de pagination réutilisable : 25 éléments par page par défaut,
 * choix entre 25 et 50. Revient en page 1 quand la liste change de taille.
 */
export function usePagination<T>(items: T[], initialSize: number = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  const paged = useMemo(() => {
    const safePage = Math.min(page, pageCount);
    return items.slice((safePage - 1) * pageSize, safePage * pageSize);
  }, [items, page, pageSize, pageCount]);

  return { paged, page: Math.min(page, pageCount), pageCount, pageSize, setPage, setPageSize, total: items.length };
}

export function PaginationBar({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (total === 0) return null;
  const fromN = (page - 1) * pageSize + 1;
  const toN = Math.min(page * pageSize, total);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      <span>
        {fromN}–{toN} sur {total}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-xs">Par page</span>
          <select
            className="field-input w-auto py-1"
            value={pageSize}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
            aria-label="Éléments par page"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md border p-1.5 disabled:opacity-40"
            style={{ borderColor: "var(--border)" }}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Page précédente"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-1 text-xs">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="rounded-md border p-1.5 disabled:opacity-40"
            style={{ borderColor: "var(--border)" }}
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label="Page suivante"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
