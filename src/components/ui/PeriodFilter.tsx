"use client";

import { useState } from "react";

export type PeriodKey = "toutes" | "aujourdhui" | "semaine" | "mois" | "personnalisee";

export interface PeriodValue {
  key: PeriodKey;
  from?: string;
  to?: string;
}

function toDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Bornes [from, to] (jours inclus) d'une période, en date locale. */
export function periodBounds(period: PeriodValue): { from?: string; to?: string } {
  const now = new Date();
  switch (period.key) {
    case "aujourdhui": {
      const d = toDay(now);
      return { from: d, to: d };
    }
    case "semaine": {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // lundi
      return { from: toDay(start), to: toDay(now) };
    }
    case "mois": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toDay(start), to: toDay(now) };
    }
    case "personnalisee":
      return { from: period.from, to: period.to };
    default:
      return {};
  }
}

/** true si la date ISO appartient à la période. */
export function inPeriod(iso: string, period: PeriodValue): boolean {
  const { from, to } = periodBounds(period);
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** Période précédente de même durée (pour les comparaisons). */
export function previousPeriod(period: PeriodValue): PeriodValue | null {
  const { from, to } = periodBounds(period);
  if (!from || !to) return null;
  const fromD = new Date(`${from}T00:00:00`);
  const toD = new Date(`${to}T00:00:00`);
  const days = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  return { key: "personnalisee", from: toDay(prevFrom), to: toDay(prevTo) };
}

/**
 * Filtre de période réutilisable : Aujourd'hui / Cette semaine / Ce mois /
 * Période personnalisée (avec dates de début et fin).
 */
export function PeriodFilter({
  value,
  onChange,
  allowAll = true,
}: {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  allowAll?: boolean;
}) {
  const [customFrom, setCustomFrom] = useState(value.from ?? "");
  const [customTo, setCustomTo] = useState(value.to ?? "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label>
        <span className="sr-only">Période</span>
        <select
          className="field-input w-auto"
          value={value.key}
          onChange={(e) => {
            const key = e.target.value as PeriodKey;
            if (key === "personnalisee") {
              onChange({ key, from: customFrom || undefined, to: customTo || undefined });
            } else {
              onChange({ key });
            }
          }}
        >
          {allowAll ? <option value="toutes">Toutes les dates</option> : null}
          <option value="aujourdhui">Aujourd&apos;hui</option>
          <option value="semaine">Cette semaine</option>
          <option value="mois">Ce mois</option>
          <option value="personnalisee">Période personnalisée</option>
        </select>
      </label>
      {value.key === "personnalisee" ? (
        <>
          <label>
            <span className="sr-only">Du</span>
            <input
              type="date"
              className="field-input w-auto"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                onChange({ key: "personnalisee", from: e.target.value || undefined, to: customTo || undefined });
              }}
            />
          </label>
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            →
          </span>
          <label>
            <span className="sr-only">Au</span>
            <input
              type="date"
              className="field-input w-auto"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                onChange({ key: "personnalisee", from: customFrom || undefined, to: e.target.value || undefined });
              }}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}
