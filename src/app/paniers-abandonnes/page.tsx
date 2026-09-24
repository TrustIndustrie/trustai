"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShoppingCart } from "lucide-react";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { formatDateTime, formatEuro } from "@/lib/format";

/**
 * Paniers abandonnés : consultation.
 *
 * Cette page NE RELANCE PERSONNE. Elle rend visible ce que Shopify garde
 * pour lui : les paniers abandonnés, leur montant, et leur éligibilité à une
 * relance. L'envoi arrive dans un lot suivant.
 *
 * L'éligibilité n'est pas décidée ici mais par la base : sans consentement
 * marketing, un panier est visible et non relançable, et aucun bouton ne
 * permet de passer outre.
 */

type Statut =
  | "a_relancer"
  | "sans_contact"
  | "sans_consentement"
  | "exclu"
  | "recupere";

interface Panier {
  id: string;
  shopify_checkout_id: string;
  abandoned_at: string;
  total_cents: number;
  currency: string | null;
  item_count: number;
  has_recovery_url: boolean;
  contact_email: string | null;
  contact_name: string | null;
  marketing_consent: boolean | null;
  status: Statut;
  exclusion_reason: string | null;
  recovered_at: string | null;
  recovered_order_reference: string | null;
}

const statutLabels: Record<Statut, string> = {
  a_relancer: "Relançable",
  sans_contact: "Sans adresse",
  sans_consentement: "Sans consentement",
  exclu: "Exclu",
  recupere: "Récupéré",
};

const statutTons: Record<Statut, "success" | "warning" | "danger" | "neutral"> = {
  a_relancer: "success",
  sans_contact: "neutral",
  sans_consentement: "warning",
  exclu: "danger",
  recupere: "success",
};

type Onglet = "tous" | Statut;

export default function PaniersAbandonnesPage() {
  const { profile } = useSession();
  const { notify } = useToast();
  const [onglet, setOnglet] = useState<Onglet>("tous");
  const [rows, setRows] = useState<Panier[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ id: string; excluded: boolean } | null>(null);
  const [note, setNote] = useState("");

  const peutDecider = profile !== null && hasPermission(profile.role, "valider_decision");
  const peutSynchroniser = profile !== null && hasPermission(profile.role, "administrer");

  const charger = useCallback(
    async (statut: Onglet) => {
      const query = statut === "tous" ? "" : `?statut=${statut}`;
      try {
        const response = await fetch(`/api/shopify/abandoned-checkouts${query}`);
        const body = (await response.json()) as {
          error?: string;
          rows?: Panier[];
          counts?: Record<string, number>;
        };
        if (!response.ok) {
          notify(body.error ?? "Lecture impossible.", "error");
          setRows([]);
          return;
        }
        setRows(body.rows ?? []);
        setCounts(body.counts ?? {});
      } catch {
        notify("Lecture impossible : réseau indisponible.", "error");
        setRows([]);
      }
    },
    [notify],
  );

  useEffect(() => {
    void charger(onglet);
  }, [charger, onglet]);

  const synchroniser = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/shopify/abandoned-checkouts/sync", {
        method: "POST",
      });
      const body = (await response.json()) as {
        error?: string;
        detail?: string;
        truncated?: boolean;
        report?: {
          rows_read?: number;
          created?: number;
          updated?: number;
          preserved?: number;
          eligible?: number;
        };
      };
      if (!response.ok) {
        notify(body.error ?? "Lecture Shopify impossible.", "error");
        return;
      }
      const r = body.report ?? {};
      notify(
        `${r.rows_read ?? 0} panier(s) lu(s) : ${r.created ?? 0} nouveau(x), ` +
          `${r.updated ?? 0} mis à jour, ${r.preserved ?? 0} décision(s) préservée(s). ` +
          `${r.eligible ?? 0} relançable(s).` +
          (body.truncated ? " Lecture tronquée : relancez-la." : ""),
      );
      await charger(onglet);
    } finally {
      setBusy(false);
    }
  };

  const envoyerDecision = async () => {
    if (!decision) return;
    if (note.trim().length < 3) {
      notify("Une décision doit être motivée.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/shopify/abandoned-checkouts/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: decision.id,
          excluded: decision.excluded,
          note: note.trim(),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        notify(body.error ?? "Décision refusée.", "error");
        return;
      }
      notify(decision.excluded ? "Panier exclu." : "Panier réintégré.");
      setDecision(null);
      setNote("");
      await charger(onglet);
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <LoadingState />;

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Paniers abandonnés</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Lus dans Shopify, qui n&apos;émet aucun événement d&apos;abandon.
            Aucune relance n&apos;est envoyée dans cette version : un panier
            n&apos;est relançable que si Shopify indique un consentement
            marketing.
          </p>
        </div>
        {peutSynchroniser ? (
          <button
            type="button"
            onClick={synchroniser}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <RefreshCw size={16} />
            {busy ? "Lecture…" : "Lire les paniers Shopify"}
          </button>
        ) : null}
      </div>

      <ViewTabs<Onglet>
        ariaLabel="Filtrer les paniers"
        value={onglet}
        onChange={setOnglet}
        tabs={[
          { key: "tous", label: "Tous", count: total },
          { key: "a_relancer", label: "Relançables", count: counts.a_relancer ?? 0 },
          {
            key: "sans_consentement",
            label: "Sans consentement",
            count: counts.sans_consentement ?? 0,
          },
          { key: "sans_contact", label: "Sans adresse", count: counts.sans_contact ?? 0 },
          { key: "exclu", label: "Exclus", count: counts.exclu ?? 0 },
          { key: "recupere", label: "Récupérés", count: counts.recupere ?? 0 },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Aucun panier abandonné"
          description="Lancez une lecture Shopify, ou attendez la tâche planifiée."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((panier) => (
            <article
              key={panier.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statutTons[panier.status]}>
                    {statutLabels[panier.status]}
                  </Badge>
                  <span className="font-semibold">{formatEuro(panier.total_cents / 100)}</span>
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {panier.item_count} article(s)
                  </span>
                </div>
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  Abandonné le {formatDateTime(panier.abandoned_at)}
                </span>
              </div>

              <div className="mt-2 text-sm">
                {panier.contact_email ? (
                  <span>
                    {panier.contact_name ? `${panier.contact_name} — ` : ""}
                    {panier.contact_email}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>
                    Aucune adresse transmise par Shopify. L&apos;accès aux
                    données client protégées n&apos;est peut-être pas approuvé.
                  </span>
                )}
                {!panier.has_recovery_url ? (
                  <span className="ml-2" style={{ color: "var(--muted)" }}>
                    · sans lien de récupération
                  </span>
                ) : null}
              </div>

              {panier.status === "recupere" ? (
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  Récupéré le {formatDateTime(panier.recovered_at ?? undefined)} par la
                  commande {panier.recovered_order_reference ?? "inconnue"}.
                </p>
              ) : null}
              {panier.exclusion_reason ? (
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  Motif : {panier.exclusion_reason}
                </p>
              ) : null}

              {peutDecider && panier.status !== "recupere" ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDecision({
                        id: panier.id,
                        excluded: panier.status !== "exclu",
                      });
                      setNote("");
                    }}
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {panier.status === "exclu" ? "Réintégrer" : "Exclure"}
                  </button>
                </div>
              ) : null}

              {decision?.id === panier.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor={`note-${panier.id}`}>
                    Motif de la décision
                  </label>
                  <textarea
                    id={`note-${panier.id}`}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="rounded-lg border p-2 text-sm"
                    style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={envoyerDecision}
                      disabled={busy}
                      className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                      style={{ background: "var(--accent)", color: "#fff" }}
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecision(null);
                        setNote("");
                      }}
                      className="rounded-lg border px-3 py-1.5 text-sm"
                      style={{ borderColor: "var(--border)" }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
