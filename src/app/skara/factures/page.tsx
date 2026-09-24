"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatDate, formatEuro } from "@/lib/format";

/**
 * Factures importées depuis Skara, en lecture seule.
 *
 * Trois choses que cet écran rend visibles et que Skara ne montre pas
 * directement : la marge creuse, c'est-à-dire une marge égale au hors taxes
 * parce que le coût d'achat de l'article manque ; la nature de chaque ligne,
 * produit, remise, service ou éco-participation ; et la contrepartie d'une
 * pièce, puisqu'une facture entièrement annulée n'existe chez Skara que sous
 * la forme de son avoir.
 */

interface Ligne {
  line_index: number;
  label: string;
  quantity: number | null;
  total_price_ttc: number | null;
  nature: string;
  nature_confirmed: boolean;
}

interface Piece {
  id: string;
  number: string | null;
  doc_type: "facture" | "avoir" | "non_emise";
  accounting_state: string | null;
  invoice_date: string | null;
  client_label: string | null;
  seller_label: string | null;
  total_ttc: number | null;
  total_ht: number | null;
  vat: number | null;
  margin_skara: number | null;
  remaining_due: number | null;
  store_name: string;
  margin_hollow: boolean;
  line_count: number;
}

interface Detail extends Piece {
  eco_ttc: number | null;
  service_ttc: number | null;
  lines: Ligne[];
  counterpart: { id: string; doc_type: string; total_ttc: number | null } | null;
}

interface Totaux {
  pieces: number;
  avoirs: number;
  non_emises: number;
  ttc: number;
  ht: number;
  vat: number;
  margin: number;
  remaining_due: number;
}

const natureLabels: Record<string, string> = {
  facture: "Facture",
  avoir: "Avoir",
  non_emise: "Non émise",
};

const natureTons: Record<string, "success" | "danger" | "warning"> = {
  facture: "success",
  avoir: "danger",
  non_emise: "warning",
};

export default function FacturesSkaraPage() {
  const { db } = useData();
  const { notify } = useToast();
  const [magasin, setMagasin] = useState("");
  const [nature, setNature] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [recherche, setRecherche] = useState("");
  const [rows, setRows] = useState<Piece[] | null>(null);
  const [totaux, setTotaux] = useState<Totaux | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const stores = db?.stores ?? [];

  const charger = useCallback(async () => {
    const params = new URLSearchParams();
    if (magasin) params.set("magasin", magasin);
    if (nature) params.set("nature", nature);
    if (du) params.set("du", du);
    if (au) params.set("au", au);
    if (recherche.trim()) params.set("recherche", recherche.trim());
    try {
      const response = await fetch(`/api/skara/factures?${params.toString()}`);
      const body = (await response.json()) as {
        error?: string;
        rows?: Piece[];
        totals?: Totaux;
      };
      if (!response.ok) {
        notify(body.error ?? "Lecture impossible.", "error");
        setRows([]);
        return;
      }
      setRows(body.rows ?? []);
      setTotaux(body.totals ?? null);
    } catch {
      notify("Lecture impossible : réseau indisponible.", "error");
      setRows([]);
    }
  }, [magasin, nature, du, au, recherche, notify]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrir = async (id: string) => {
    try {
      const response = await fetch(`/api/skara/factures?id=${encodeURIComponent(id)}`);
      const body = (await response.json()) as { error?: string; invoice?: Detail };
      if (!response.ok || !body.invoice) {
        notify(body.error ?? "Pièce introuvable.", "error");
        return;
      }
      setDetail(body.invoice);
    } catch {
      notify("Lecture impossible : réseau indisponible.", "error");
    }
  };

  if (rows === null) return <LoadingState />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Factures Skara</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Lecture seule des pièces importées. Skara reste l&apos;outil officiel,
          rien n&apos;est modifié ici.
        </p>
      </div>

      <section
        className="rounded-xl border p-3"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select
            aria-label="Magasin"
            value={magasin}
            onChange={(e) => setMagasin(e.target.value)}
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--bg)" }}
          >
            <option value="">Tous les magasins</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Nature de pièce"
            value={nature}
            onChange={(e) => setNature(e.target.value)}
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--bg)" }}
          >
            <option value="">Toutes natures</option>
            <option value="facture">Factures</option>
            <option value="avoir">Avoirs</option>
            <option value="non_emise">Non émises</option>
          </select>
          <input
            aria-label="Date de début"
            type="date"
            value={du}
            onChange={(e) => setDu(e.target.value)}
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--bg)" }}
          />
          <input
            aria-label="Date de fin"
            type="date"
            value={au}
            onChange={(e) => setAu(e.target.value)}
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--bg)" }}
          />
          <div className="flex items-center gap-1 rounded-lg border p-2"
               style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            <Search size={14} style={{ color: "var(--muted)" }} />
            <input
              aria-label="Numéro ou client"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Numéro ou client"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>
      </section>

      {totaux ? (
        <section className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Pièces", value: String(totaux.pieces) },
            { label: "dont avoirs", value: String(totaux.avoirs) },
            { label: "Toutes taxes", value: formatEuro(Number(totaux.ttc ?? 0)) },
            { label: "Hors taxes", value: formatEuro(Number(totaux.ht ?? 0)) },
            { label: "Marge Skara", value: formatEuro(Number(totaux.margin ?? 0)) },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {item.label}
              </p>
              <p className="text-lg font-bold">{item.value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucune pièce"
          description="Importez un export Skara, ou élargissez les filtres."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((piece) => (
            <article
              key={piece.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={natureTons[piece.doc_type]}>
                    {natureLabels[piece.doc_type]}
                  </Badge>
                  <span className="font-semibold">{piece.number ?? "sans numéro"}</span>
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {piece.store_name} · {formatDate(piece.invoice_date ?? undefined)}
                  </span>
                </div>
                <span className="font-semibold">
                  {formatEuro(Number(piece.total_ttc ?? 0))}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span>{piece.client_label ?? "client non renseigné"}</span>
                {piece.seller_label ? (
                  <span style={{ color: "var(--muted)" }}>· {piece.seller_label}</span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>· sans vendeur</span>
                )}
                {piece.margin_hollow ? (
                  <Badge tone="warning">coût d&apos;achat manquant</Badge>
                ) : null}
                {piece.accounting_state === "exportee" ? (
                  <Badge tone="neutral">exportée en compta</Badge>
                ) : null}
              </div>

              {piece.line_count > 0 ? (
                <button
                  type="button"
                  onClick={() => ouvrir(piece.id)}
                  className="mt-2 rounded-lg border px-3 py-1.5 text-sm font-medium"
                  style={{ borderColor: "var(--border)" }}
                >
                  Voir les {piece.line_count} ligne(s)
                </button>
              ) : (
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  Aucune ligne importée pour cette pièce. L&apos;export des lignes de
                  factures du même magasin et de la même période la complètera.
                </p>
              )}

              {detail?.id === piece.id ? (
                <div className="mt-2 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
                  {detail.counterpart ? (
                    <p className="mb-2 text-sm">
                      Cette pièce a une contrepartie :{" "}
                      {natureLabels[detail.counterpart.doc_type] ?? detail.counterpart.doc_type}{" "}
                      de {formatEuro(Number(detail.counterpart.total_ttc ?? 0))}.
                    </p>
                  ) : null}
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "var(--muted)" }}>
                        <th className="text-left font-medium">Libellé</th>
                        <th className="text-left font-medium">Nature</th>
                        <th className="text-right font-medium">Qté</th>
                        <th className="text-right font-medium">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((ligne) => (
                        <tr key={ligne.line_index}>
                          <td className="py-1">{ligne.label}</td>
                          <td className="py-1">
                            {ligne.nature}
                            {ligne.nature_confirmed ? "" : " (proposée)"}
                          </td>
                          <td className="py-1 text-right">{ligne.quantity ?? "—"}</td>
                          <td className="py-1 text-right">
                            {formatEuro(Number(ligne.total_price_ttc ?? 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="mt-2 text-sm underline"
                  >
                    Replier
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
