"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  FileSpreadsheet,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Wand2,
} from "lucide-react";
import { useData, BusinessError } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/format";
import type { RecapSource } from "@/lib/types";

/**
 * Configuration et synchronisation du récapitulatif Google Sheets.
 *
 * TRUST AI lit le fichier en LECTURE SEULE : il n'y écrit jamais. Seul
 * l'Apps Script installé dans le Sheet alimente la colonne « ID TRUST »
 * (voir docs/RECAP_GOOGLE_SHEETS.md).
 *
 * Le fichier réel est organisé PAR ANNÉE : un onglet par exercice. Chaque
 * onglet se configure séparément — les colonnes peuvent différer d'une année
 * sur l'autre, et c'est déjà le cas.
 */

interface Field {
  key: string;
  label: string;
  hint?: string;
}

/** Champs regroupés comme le fichier lui-même est organisé. */
const GROUPS: { title: string; note?: string; fields: Field[] }[] = [
  {
    title: "Identification",
    fields: [
      {
        key: "recap_row_id",
        label: "ID TRUST",
        hint: "Colonne remplie automatiquement par le script du Sheet",
      },
      { key: "recap_date", label: "Date du récap" },
      { key: "status_label", label: "Statut" },
    ],
  },
  {
    title: "Article et client",
    fields: [
      { key: "supplier_label", label: "Fournisseur" },
      { key: "supplier_reference", label: "Référence fournisseur" },
      { key: "designation", label: "Désignation" },
      { key: "quantity", label: "Quantité" },
      { key: "customer_label", label: "Client" },
      {
        key: "supplier_order_ref",
        label: "ORDER",
        hint: "Numéro de commande du FOURNISSEUR, pas la commande client",
      },
      { key: "expected_at", label: "Arrivage prévu" },
    ],
  },
  {
    title: "Commentaires",
    note: "Le fichier en a deux, et les deux portent des informations utiles (annulations, SAV, retours). Les deux sont lues.",
    fields: [
      { key: "comments", label: "Commentaires (1)" },
      { key: "comments_2", label: "Commentaires (2)" },
    ],
  },
  {
    title: "Dépôt d'Argenteuil",
    fields: [
      { key: "received_argenteuil", label: "Reçu" },
      { key: "received_argenteuil_at", label: "Date de réception" },
    ],
  },
  {
    title: "Transfert vers Aubagne",
    note: "Le numéro d'affrètement est ce qui matérialise le transfert Argenteuil → Aubagne.",
    fields: [
      { key: "freight_label", label: "Affrètement" },
      { key: "exit_mode_label", label: "Expéditeur" },
    ],
  },
  {
    title: "Dépôt d'Aubagne",
    fields: [
      { key: "received_aubagne", label: "Marchandise reçue" },
      { key: "received_aubagne_at", label: "Date de réception dépôt" },
    ],
  },
  {
    title: "Sorties vers le client",
    note: "Trois chemins possibles, exclusifs. Une ligne close par l'un des trois n'est plus disponible : il faut les renseigner tous les trois, sinon TRUST AI annoncera de la marchandise déjà partie.",
    fields: [
      { key: "paris_release_label", label: "Paris — marqueur" },
      { key: "paris_release_at", label: "Paris — date" },
      { key: "aubagne_delivery_label", label: "Livraison Aubagne — statut" },
      { key: "aubagne_delivery_at", label: "Livraison Aubagne — date" },
      { key: "aubagne_pickup_label", label: "Retrait Aubagne — statut" },
      { key: "aubagne_pickup_at", label: "Retrait Aubagne — date" },
    ],
  },
];

/**
 * Correspondance du récapitulatif de Trust Industrie, telle qu'établie en
 * analysant le fichier. Elle sert de point de départ : tout reste modifiable.
 * Les lettres visent les colonnes sans titre (G, P, W) et départagent les
 * deux colonnes « COMMENTAIRES » (J et N).
 */
const MODELE_TRUST: Record<string, string> = {
  recap_row_id: "ID TRUST",
  recap_date: "A",
  supplier_label: "B",
  status_label: "C",
  supplier_reference: "D",
  designation: "E",
  quantity: "F",
  customer_label: "G",
  supplier_order_ref: "H",
  expected_at: "I",
  comments: "J",
  comments_2: "N",
  received_argenteuil: "K",
  received_argenteuil_at: "L",
  freight_label: "M",
  exit_mode_label: "O",
  received_aubagne: "S",
  received_aubagne_at: "R",
  paris_release_label: "P",
  paris_release_at: "Q",
  aubagne_delivery_label: "T",
  aubagne_delivery_at: "U",
  aubagne_pickup_label: "V",
  aubagne_pickup_at: "W",
};

const MODELE_TRANSPORTEURS = "OMAR, GEODIS, GUISNEL, DEFITRANS, COCOLIS";

interface PreviewRow {
  ignored: boolean;
  ignoredReason?: string;
  rowNumber: number;
  recap_row_id?: string;
  designation?: string;
  quantity: number;
  customer_label?: string;
  supplier_label?: string;
  supplier_order_ref?: string;
  stage: string;
  destination_confidence: string;
  anomalies: { type: string; message: string }[];
}

const EMPTY_FORM = {
  id: "",
  label: "",
  spreadsheetId: "",
  sheetName: "",
  headerRow: "4",
  idColumn: "ID TRUST",
  carriers: "",
};

export default function RecapPage() {
  const { mode, listRecapSources, saveRecapSource, setRecapSourceActive } = useData();
  const { profile } = useSession();
  const { notify } = useToast();

  const [sources, setSources] = useState<RecapSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    summary: Record<string, number | string[]>;
    rows: PreviewRow[];
  } | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const [lastReport, setLastReport] = useState<Record<string, number> | null>(null);

  const canImport =
    mode === "connected" && profile !== null && hasPermission(profile.role, "importer_recap");

  const applySource = useCallback((value: RecapSource) => {
    setSelectedId(value.id);
    setForm({
      id: value.id,
      label: value.label,
      spreadsheetId: value.spreadsheetId,
      sheetName: value.sheetName,
      headerRow: String(value.headerRow || 1),
      idColumn: value.idColumn ?? "ID TRUST",
      carriers: (value.clientCarriers ?? []).join(", "),
    });
    setMapping(value.columnMapping ?? {});
    setPreview(null);
  }, []);

  const load = useCallback(
    async (keepId?: string | null) => {
      if (mode !== "connected") {
        setLoading(false);
        return;
      }
      try {
        const list = await listRecapSources();
        setSources(list);
        const target = list.find((s) => s.id === keepId) ?? list[0];
        if (target) applySource(target);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Lecture impossible.", "error");
      }
      setLoading(false);
    },
    [mode, listRecapSources, notify, applySource],
  );

  useEffect(() => {
    void load(null);
    // Chargement initial uniquement : les rechargements passent par `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveRecapSource({
        id: form.id || undefined,
        label: form.label.trim() || form.sheetName.trim() || "Récapitulatif",
        spreadsheetId: form.spreadsheetId.trim(),
        sheetName: form.sheetName.trim(),
        headerRow: Number(form.headerRow) || 1,
        idColumn: form.idColumn.trim() || undefined,
        columnMapping: Object.fromEntries(
          Object.entries(mapping).filter(([, v]) => v.trim() !== ""),
        ),
        clientCarriers: form.carriers
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      });
      notify("Configuration enregistrée.");
      await load(form.id || null);
    } catch (error) {
      notify(
        error instanceof BusinessError || error instanceof Error
          ? error.message
          : "Enregistrement impossible.",
        "error",
      );
    }
    setBusy(false);
  };

  const toggleActive = async (source: RecapSource) => {
    setBusy(true);
    try {
      await setRecapSourceActive(source.id, !source.active);
      notify(
        source.active
          ? "Onglet mis en sommeil. Aucune ligne n'a été supprimée."
          : "Onglet réactivé.",
      );
      await load(source.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Action impossible.", "error");
    }
    setBusy(false);
  };

  const run = async (isPreview: boolean) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ source: selectedId });
      if (isPreview) params.set("preview", "1");
      const response = await fetch(`/api/recap/sync?${params.toString()}`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        notify(body.error ?? "Synchronisation impossible.", "error");
      } else if (isPreview) {
        setPreview({ summary: body.summary, rows: body.rows ?? [] });
        notify(
          `Prévisualisation : ${body.summary.kept} ligne(s) exploitable(s), ${body.summary.ignored} ignorée(s).`,
        );
      } else {
        setLastReport(body.report);
        setPreview(null);
        notify(
          `Synchronisation terminée : ${body.report.created} créée(s), ${body.report.updated} modifiée(s), ${body.report.unchanged} inchangée(s).`,
        );
        await load(selectedId);
      }
    } catch {
      notify("Erreur réseau.", "error");
    }
    setBusy(false);
  };

  if (mode === "demo") {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <h1 className="text-xl font-bold">Récapitulatif</h1>
        <div className="card p-6 text-sm">
          <p>
            La connexion au fichier récapitulatif s&apos;appuie sur la base
            partagée et n&apos;est active qu&apos;en <strong>mode connecté</strong>.
          </p>
        </div>
      </div>
    );
  }

  if (!canImport) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <h1 className="text-xl font-bold">Récapitulatif</h1>
        <div className="card p-6 text-sm">
          <p>Votre rôle ne permet pas de configurer ni de synchroniser le récapitulatif.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <FileSpreadsheet size={20} aria-hidden style={{ color: "var(--primary)" }} />
            Récapitulatif Google Sheets
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Source de la disponibilité des marchandises. TRUST AI lit le
            fichier, ne le modifie jamais.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !selectedId}
            onClick={() => run(true)}
          >
            <Eye size={15} aria-hidden />
            Prévisualiser
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !selectedId}
            onClick={() => setConfirmSync(true)}
          >
            <RefreshCw size={15} aria-hidden className={busy ? "animate-spin" : undefined} />
            Synchroniser maintenant
          </button>
        </div>
      </div>

      {/* Onglets configurés */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Onglets suivis</h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSelectedId(null);
              setForm({ ...EMPTY_FORM });
              setMapping({});
              setPreview(null);
            }}
          >
            <Plus size={15} aria-hidden />
            Ajouter un onglet
          </button>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Le fichier est organisé par année : un onglet par exercice. Chacun se
          configure séparément.
        </p>

        {loading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>Chargement…</p>
        ) : sources.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Aucun onglet configuré pour l&apos;instant.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {sources.map((source) => (
              <li
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                style={{
                  borderColor:
                    source.id === selectedId ? "var(--primary)" : "var(--border)",
                  background:
                    source.id === selectedId ? "var(--primary-soft)" : undefined,
                }}
              >
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => applySource(source)}
                >
                  <span className="font-semibold">{source.label}</span>
                  <span style={{ color: "var(--muted)" }}> · onglet « {source.sheetName} »</span>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={source.active ? "success" : "neutral"}>
                      {source.active ? "Actif" : "En sommeil"}
                    </Badge>
                    <span style={{ color: "var(--muted)" }}>
                      {source.linesCount} ligne(s) importée(s)
                    </span>
                    <span style={{ color: "var(--muted)" }}>
                      {source.lastReadAt
                        ? `Dernière lecture ${formatDateTime(source.lastReadAt)}`
                        : "Jamais lue"}
                    </span>
                  </p>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => toggleActive(source)}
                >
                  {source.active ? (
                    <>
                      <Moon size={14} aria-hidden />
                      Mettre en sommeil
                    </>
                  ) : (
                    <>
                      <Sun size={14} aria-hidden />
                      Réactiver
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected?.lastRead ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Dernière lecture de « {selected.sheetName} » :{" "}
            {selected.lastRead.rowsRead} ligne(s) lue(s) ·{" "}
            {selected.lastRead.rowsCreated} créée(s) ·{" "}
            {selected.lastRead.rowsUpdated} modifiée(s) ·{" "}
            {selected.lastRead.report?.unchanged ?? 0} inchangée(s) ·{" "}
            {selected.lastRead.rowsIgnored} ignorée(s) ·{" "}
            {selected.lastRead.errorsCount} anomalie(s) ·{" "}
            {selected.lastRead.report?.missing ?? 0} absente(s)
          </p>
        ) : null}
        {lastReport ? (
          <p className="mt-2 text-sm">
            Résultat : {lastReport.created} créée(s), {lastReport.updated} modifiée(s),{" "}
            {lastReport.unchanged} inchangée(s), {lastReport.ignored} ignorée(s),{" "}
            {lastReport.anomalies} anomalie(s), {lastReport.missing} absente(s).
          </p>
        ) : null}
      </div>

      {/* Configuration */}
      <form onSubmit={save} className="card flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {form.id ? `Configuration de « ${form.sheetName} »` : "Nouvel onglet"}
          </h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setMapping({ ...MODELE_TRUST });
              setForm((f) => ({
                ...f,
                headerRow: "4",
                idColumn: "ID TRUST",
                carriers: MODELE_TRANSPORTEURS,
              }));
              notify("Modèle rempli. Vérifiez, puis prévisualisez avant d'enregistrer.");
            }}
          >
            <Wand2 size={15} aria-hidden />
            Remplir avec le format Trust Industrie
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>
            <span className="field-label">Identifiant du Google Sheet</span>
            <input
              className="field-input"
              value={form.spreadsheetId}
              onChange={(e) => setForm({ ...form, spreadsheetId: e.target.value })}
              placeholder="1AbCdEf…"
              required
            />
            <span className="field-hint">
              Dans l&apos;URL du fichier, entre <code>/d/</code> et <code>/edit</code>.
            </span>
          </label>
          <label>
            <span className="field-label">Nom de l&apos;onglet</span>
            <input
              className="field-input"
              value={form.sheetName}
              onChange={(e) => setForm({ ...form, sheetName: e.target.value })}
              placeholder="INTERNET"
              required
            />
            <span className="field-hint">
              Au caractère près, tel qu&apos;affiché en bas du Google Sheet.
            </span>
          </label>
          <label>
            <span className="field-label">Libellé dans TRUST AI</span>
            <input
              className="field-input"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Récapitulatif Internet"
            />
            <span className="field-hint">Purement décoratif.</span>
          </label>
          <label>
            <span className="field-label">Ligne des en-têtes</span>
            <input
              type="number"
              min={1}
              className="field-input"
              value={form.headerRow}
              onChange={(e) => setForm({ ...form, headerRow: e.target.value })}
            />
            <span className="field-hint">
              4 pour le récapitulatif de Trust Industrie (bandeaux au-dessus).
            </span>
          </label>
          <label>
            <span className="field-label">Colonne « ID TRUST »</span>
            <input
              className="field-input"
              value={form.idColumn}
              onChange={(e) => setForm({ ...form, idColumn: e.target.value })}
            />
            <span className="field-hint">
              Remplie automatiquement par le script installé dans le Sheet.
            </span>
          </label>
          <label>
            <span className="field-label">Transporteurs qui livrent le client</span>
            <input
              className="field-input"
              value={form.carriers}
              onChange={(e) => setForm({ ...form, carriers: e.target.value })}
              placeholder="OMAR, GEODIS, GUISNEL"
            />
            <span className="field-hint">
              Séparés par des virgules. Sert à comprendre la destination quand
              rien d&apos;autre ne l&apos;indique — à compléter quand un nouveau
              transporteur apparaît.
            </span>
          </label>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Correspondance des colonnes</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Indiquez le <strong>titre exact</strong> de la colonne, ou sa{" "}
            <strong>lettre</strong> (<code>G</code>, <code>AB</code>) — utile
            quand la colonne n&apos;a pas de titre ou que deux colonnes portent
            le même. Laissez vide si la colonne n&apos;existe pas.
          </p>
          {GROUPS.map((group) => (
            <fieldset key={group.title} className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {group.title}
              </legend>
              {group.note ? (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {group.note}
                </p>
              ) : null}
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((field) => (
                  <label key={field.key}>
                    <span className="field-label">{field.label}</span>
                    <input
                      className="field-input"
                      value={mapping[field.key] ?? ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field.key]: e.target.value })
                      }
                    />
                    {field.hint ? <span className="field-hint">{field.hint}</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {form.id ? "Enregistrer les modifications" : "Ajouter cet onglet"}
          </button>
        </div>
      </form>

      {/* Prévisualisation */}
      {preview ? (
        <div className="card p-4">
          <h2 className="text-sm font-semibold">
            Prévisualisation — aucune donnée enregistrée
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {String(preview.summary.kept)} ligne(s) exploitable(s) ·{" "}
            {String(preview.summary.ignored)} ignorée(s) ·{" "}
            {String(preview.summary.anomalies)} anomalie(s) ·{" "}
            {String(preview.summary.withId)} avec ID TRUST
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th scope="col">Ligne</th>
                  <th scope="col">Article</th>
                  <th scope="col">Client</th>
                  <th scope="col">Fournisseur</th>
                  <th scope="col">Étape</th>
                  <th scope="col">Anomalies</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>
                      {row.ignored ? (
                        <em style={{ color: "var(--muted)" }}>{row.ignoredReason}</em>
                      ) : (
                        <>
                          {row.designation ?? "—"}
                          <span style={{ color: "var(--muted)" }}> × {row.quantity}</span>
                        </>
                      )}
                    </td>
                    <td>{row.customer_label ?? "—"}</td>
                    <td>
                      {row.supplier_label ?? "—"}
                      {row.supplier_order_ref ? (
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          Commande fournisseur : {row.supplier_order_ref}
                        </p>
                      ) : null}
                    </td>
                    <td>{row.ignored ? "—" : row.stage}</td>
                    <td>
                      {row.anomalies?.length ? (
                        <Badge tone="warning">{row.anomalies.length}</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmSync}
        title="Synchroniser cet onglet ?"
        description="Les lignes du fichier seront créées ou mises à jour dans TRUST AI. Le Google Sheet n'est jamais modifié, et aucune ligne existante n'est supprimée."
        confirmLabel="Synchroniser"
        onCancel={() => setConfirmSync(false)}
        onConfirm={() => {
          setConfirmSync(false);
          void run(false);
        }}
      />
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
