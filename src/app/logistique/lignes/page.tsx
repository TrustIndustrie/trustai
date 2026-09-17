"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, PackageSearch, Search, X } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, formatDateTime } from "@/lib/format";
import { exitChannelLabels, logisticsStageLabels } from "@/lib/labels";
import type {
  ExitChannel,
  LogisticsLineDetail,
  LogisticsLineRow,
  RecapSource,
} from "@/lib/types";

/**
 * Lignes du récapitulatif : recherche, filtres, pagination, détail et
 * historique. Toutes les données proviennent de fonctions serveur — aucune
 * table logistique n'est lisible directement depuis le navigateur.
 */
const PAGE_SIZE = 25;

const STAGES = [
  "a_commander",
  "commandee",
  "attendue",
  "recue_argenteuil",
  "en_transfert",
  "recue_aubagne",
  "disponible",
  "sortie",
  "annulee",
];

/** Les trois chemins de sortie, dans l'ordre où ils apparaissent au fichier. */
const EXIT_CHANNELS: ExitChannel[] = ["paris", "livraison_aubagne", "retrait_aubagne"];

export default function LogisticsLinesPage() {
  const { mode, listLogisticsLines, getLogisticsLine, listRecapSources, db } = useData();
  const { profile } = useSession();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [supplier, setSupplier] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [exitChannel, setExitChannel] = useState("");
  const [sources, setSources] = useState<RecapSource[]>([]);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<LogisticsLineRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<LogisticsLineDetail | null>(null);

  const canRead =
    mode === "connected" &&
    profile !== null &&
    (hasPermission(profile.role, "gerer_livraisons") ||
      hasPermission(profile.role, "gerer_logistique"));

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const result = await listLogisticsLines({
        search: search.trim() || undefined,
        stage: stage || undefined,
        supplier: supplier || undefined,
        warehouseId: warehouseId || undefined,
        onlyAnomalies,
        sourceId: sourceId || undefined,
        exitChannel: (exitChannel || undefined) as ExitChannel | undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lecture impossible.", "error");
    }
    setLoading(false);
  }, [
    canRead, listLogisticsLines, search, stage, supplier, warehouseId,
    onlyAnomalies, sourceId, exitChannel, page, notify,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // Les onglets servent uniquement à alimenter le filtre : un rôle qui lit les
  // lignes sans pouvoir configurer le récapitulatif n'a pas d'onglet à choisir.
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    listRecapSources()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, listRecapSources]);

  const openDetail = async (lineId: string) => {
    try {
      setDetail(await getLogisticsLine(lineId));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lecture impossible.", "error");
    }
  };

  if (mode === "demo") {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <h1 className="text-xl font-bold">Lignes du récapitulatif</h1>
        <div className="card p-6 text-sm">
          <p>
            Les lignes du récapitulatif proviennent de la base partagée :
            cette page n&apos;est active qu&apos;en <strong>mode connecté</strong>.
          </p>
        </div>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <h1 className="text-xl font-bold">Lignes du récapitulatif</h1>
        <div className="card p-6 text-sm">
          <p>Votre rôle ne permet pas de consulter les lignes logistiques.</p>
        </div>
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const suppliers = Array.from(
    new Set(rows.map((r) => r.supplier_label).filter((s): s is string => Boolean(s))),
  ).sort();

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <PackageSearch size={20} aria-hidden style={{ color: "var(--primary)" }} />
          Lignes du récapitulatif
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {total} ligne(s) suivie(s). Chaque ligne correspond à un article
          attendu ou disponible.
        </p>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative lg:col-span-2">
          <span className="sr-only">Rechercher</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted)" }}
            aria-hidden
          />
          <input
            className="field-input pl-9"
            placeholder="Article, client, référence, ID TRUST…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          <span className="sr-only">Étape</span>
          <select
            className="field-input"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Toutes les étapes</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {logisticsStageLabels[s]?.label ?? s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Fournisseur</span>
          <select
            className="field-input"
            value={supplier}
            onChange={(e) => {
              setSupplier(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Tous les fournisseurs</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Dépôt</span>
          <select
            className="field-input"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Tous les dépôts</option>
            {(db?.warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Chemin de sortie</span>
          <select
            className="field-input"
            value={exitChannel}
            onChange={(e) => {
              setExitChannel(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Tous les chemins de sortie</option>
            {EXIT_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {exitChannelLabels[c]?.label ?? c}
              </option>
            ))}
          </select>
        </label>
        {sources.length > 1 ? (
          <label>
            <span className="sr-only">Onglet du récapitulatif</span>
            <select
              className="field-input"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Tous les onglets</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.sheetName})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyAnomalies}
            onChange={(e) => {
              setOnlyAnomalies(e.target.checked);
              setPage(0);
            }}
          />
          Anomalies uniquement
        </label>
      </div>

      {loading ? (
        <div className="card p-6 text-sm" style={{ color: "var(--muted)" }}>
          Chargement…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucune ligne"
          description="Configurez la source puis lancez une synchronisation depuis la page Récapitulatif."
          icon={PackageSearch}
        />
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Article</th>
                  <th scope="col">Client</th>
                  <th scope="col">Fournisseur</th>
                  <th scope="col">Étape</th>
                  <th scope="col">Destination</th>
                  <th scope="col">Sortie</th>
                  <th scope="col">Arrivée prévue</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const stageInfo = logisticsStageLabels[row.stage];
                  return (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          className="text-left font-medium underline"
                          style={{ color: "var(--primary)" }}
                          onClick={() => openDetail(row.id)}
                        >
                          {row.designation}
                        </button>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          × {row.quantity}
                          {row.supplier_reference ? ` · ${row.supplier_reference}` : ""}
                          {row.recap_row_id ? ` · ${row.recap_row_id}` : ""}
                        </p>
                      </td>
                      <td>{row.customer_label ?? "—"}</td>
                      <td>
                        {row.supplier_label ?? "—"}
                        {row.supplier_order_ref ? (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            Cde fournisseur : {row.supplier_order_ref}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={stageInfo?.tone ?? "neutral"}>
                          {stageInfo?.label ?? row.stage}
                        </Badge>
                      </td>
                      <td>
                        {row.destination_label ?? "—"}
                        {row.destination_confidence === "ambigue" ? (
                          <p className="text-xs" style={{ color: "var(--warning)" }}>
                            à confirmer
                          </p>
                        ) : null}
                      </td>
                      <td>
                        {row.exit_channel ? (
                          <>
                            <Badge tone={exitChannelLabels[row.exit_channel]?.tone ?? "neutral"}>
                              {exitChannelLabels[row.exit_channel]?.label ?? row.exit_channel}
                            </Badge>
                            {row.exit_at ? (
                              <p className="text-xs" style={{ color: "var(--muted)" }}>
                                {formatDate(row.exit_at)}
                              </p>
                            ) : null}
                          </>
                        ) : row.freight_ref ? (
                          <span className="text-xs" style={{ color: "var(--muted)" }}>
                            Affrètement {row.freight_ref}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {row.expected_at ? formatDate(row.expected_at) : "—"}
                      </td>
                      <td>
                        {row.missing_since ? (
                          <Badge tone="warning">Absente du fichier</Badge>
                        ) : row.open_anomalies > 0 ? (
                          <Badge tone="warning">{row.open_anomalies} anomalie(s)</Badge>
                        ) : (
                          <Badge tone="success">À jour</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm"
               style={{ borderColor: "var(--border)" }}>
            <span style={{ color: "var(--muted)" }}>
              Page {page + 1} / {pageCount} — {total} ligne(s)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Précédente
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivante
              </button>
            </div>
          </div>
        </div>
      )}

      {detail?.line ? (
        <LineDetail detail={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}

function LineDetail({
  detail,
  onClose,
}: {
  detail: LogisticsLineDetail;
  onClose: () => void;
}) {
  const line = detail.line as Record<string, string | number | null>;
  const raw = (line.raw_row ?? {}) as unknown as Record<string, string>;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(20,18,14,0.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Détail de la ligne"
    >
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{String(line.designation ?? "")}</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              × {String(line.quantity ?? "")}
              {line.customer_label ? ` · ${line.customer_label}` : ""}
              {line.recap_row_id ? ` · ${line.recap_row_id}` : ""}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose} aria-label="Fermer">
            <X size={15} aria-hidden />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Info label="Fournisseur" value={line.supplier_label} />
          <Info label="Référence fournisseur" value={line.supplier_reference} />
          <Info label="Commande fournisseur (ORDER)" value={line.supplier_order_ref} />
          <Info label="Étape" value={logisticsStageLabels[String(line.stage)]?.label ?? line.stage} />
          <Info label="Arrivée prévue" value={line.expected_at ? formatDate(String(line.expected_at)) : null} />
          <Info label="Vue pour la dernière fois" value={line.last_seen_at ? formatDateTime(String(line.last_seen_at)) : null} />
          <Info label="Dernier changement" value={line.last_changed_at ? formatDateTime(String(line.last_changed_at)) : null} />
          <Info label="Absente depuis" value={line.missing_since ? formatDateTime(String(line.missing_since)) : null} />
        </dl>

        {line.comments ? (
          <p className="mt-3 rounded-md border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
            {String(line.comments)}
          </p>
        ) : null}

        <h3 className="mt-5 text-sm font-semibold">Historique logistique</h3>
        {detail.events.length === 0 ? (
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Aucun événement.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {detail.events.map((event, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span className="font-medium">{formatDate(String(event.occurred_on))}</span>
                <span>{String(event.event_type).replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-5 text-sm font-semibold">Anomalies</h3>
        {detail.anomalies.length === 0 ? (
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Aucune anomalie.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {detail.anomalies.map((anomaly, i) => (
              <li key={i}>
                <Badge tone={anomaly.resolved_at ? "neutral" : "warning"}>
                  {String(anomaly.type).replace(/_/g, " ")}
                </Badge>{" "}
                {String(anomaly.message)}
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-5 text-sm font-semibold">Ligne source (audit)</h3>
        <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {Object.entries(raw).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt style={{ color: "var(--muted)" }}>{key} :</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt style={{ color: "var(--muted)" }}>{label}</dt>
      <dd className="text-right font-medium">{value ? String(value) : "—"}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/logistique"
      className="inline-flex items-center gap-1 text-sm font-medium"
      style={{ color: "var(--muted)" }}
    >
      <ArrowLeft size={14} aria-hidden />
      Logistique
    </Link>
  );
}
