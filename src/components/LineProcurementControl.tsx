"use client";

import { useState } from "react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { procurementStatusLabels } from "@/lib/labels";
import type { OrderLine, ProcurementStatus } from "@/lib/types";

/** Statuts décidés par un humain (les autres sont pilotés par le suivi). */
const MANUAL_STATUSES: ProcurementStatus[] = [
  "a_verifier",
  "stock_local",
  "a_commander",
  "indisponible",
];

/**
 * Qualification d'une ligne de commande : « à vérifier » → stock local,
 * à commander (avec son fournisseur) ou indisponible. C'est cette étape qui
 * alimente la page Achats fournisseurs.
 *
 * L'affichage du contrôle n'est qu'un confort : la permission réelle
 * (« gerer_achats ») est revérifiée côté serveur par la fonction
 * set_line_procurement, qui refuse aussi les commandes annulées.
 */
export function LineProcurementControl({
  line,
  orderCancelled,
}: {
  line: OrderLine;
  orderCancelled: boolean;
}) {
  const { db, mode, updateLineStatus } = useData();
  const { profile } = useSession();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  const status = procurementStatusLabels[line.procurementStatus];
  const canEdit =
    !orderCancelled &&
    MANUAL_STATUSES.includes(line.procurementStatus) &&
    (mode === "demo" || (profile !== null && hasPermission(profile.role, "gerer_achats")));

  if (!canEdit) return <Badge tone={status.tone}>{status.label}</Badge>;

  const apply = async (next: ProcurementStatus, supplierId?: string) => {
    setBusy(true);
    try {
      await updateLineStatus(line.id, next, supplierId ? { supplierId } : undefined);
      notify(
        next === "a_commander"
          ? "Article à commander : il apparaît dans Achats fournisseurs."
          : `Suivi mis à jour : ${procurementStatusLabels[next].label.toLowerCase()}.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Action impossible.", "error");
    }
    setBusy(false);
  };

  const onChange = async (value: string) => {
    if (value === line.procurementStatus) return;
    const next = value as ProcurementStatus;
    if (next === "a_commander" && !line.supplierId) {
      // Le fournisseur principal est obligatoire pour pouvoir regrouper la
      // ligne dans une commande fournisseur : on le demande ici.
      notify("Choisissez d'abord le fournisseur de cet article.", "error");
      return;
    }
    await apply(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <select
        className="field-input py-1 text-xs"
        value={line.procurementStatus}
        disabled={busy}
        aria-label={`Suivi de l'article ${line.productName}`}
        onChange={(e) => onChange(e.target.value)}
      >
        {MANUAL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {procurementStatusLabels[s].label}
          </option>
        ))}
      </select>
      {!line.supplierId ? (
        <select
          className="field-input py-1 text-xs"
          defaultValue=""
          disabled={busy}
          aria-label={`Fournisseur de l'article ${line.productName}`}
          onChange={(e) => {
            if (e.target.value) void apply("a_commander", e.target.value);
          }}
        >
          <option value="">Fournisseur → à commander…</option>
          {(db?.suppliers ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
