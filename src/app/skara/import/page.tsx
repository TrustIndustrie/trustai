"use client";

import { useCallback, useEffect, useState } from "react";
import { FileUp, History } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * Dépôt des exports Skara.
 *
 * Skara reste l'outil officiel. Cet écran ne fait qu'y prendre des fichiers
 * que vous avez exportés vous-même, pour en tirer une vue interne. Rien
 * n'est envoyé vers Skara, et la prévisualisation est obligatoire : aucune
 * écriture avant que vous ayez vu les totaux et les anomalies.
 */

type Nature = "liste_factures" | "lignes_factures" | "catalogue" | "journal_comptable";

const natures: { key: Nature; label: string; aide: string; magasin: boolean }[] = [
  {
    key: "liste_factures",
    label: "Liste des factures",
    aide: "Comptabilité, Gestion des factures, bouton « Export csv ».",
    magasin: true,
  },
  {
    key: "lignes_factures",
    label: "Lignes de factures",
    aide: "Même écran, bouton « Export csv des lignes factures ».",
    magasin: true,
  },
  {
    key: "catalogue",
    label: "Catalogue des articles",
    aide: "Catalogue, Gestion des articles : lancez la recherche, sélectionnez, puis exportez.",
    magasin: false,
  },
  {
    key: "journal_comptable",
    label: "Journal comptable",
    aide:
      "Comptabilité, Export comptable, bouton « Historique » : retéléchargez un export existant. Ne lancez JAMAIS un nouvel export, il consommerait les écritures de votre comptable.",
    magasin: false,
  },
];

interface Anomalie {
  kind: string;
  severity: "info" | "avertissement" | "bloquant";
  message: string;
}

interface Resume {
  nature: string;
  lignes: number;
  periode: { start: string | null; end: string | null };
  prefixes: string[];
  pied: Record<string, string | null> | null;
  calcule: Record<string, number>;
  anomalies: Anomalie[];
  bloquant: boolean;
}

interface ImportRecent {
  id: string;
  kind: string;
  file_name: string;
  store_name: string | null;
  period_start: string | null;
  period_end: string | null;
  rows_received: number;
  rows_created: number;
  rows_updated: number;
  imported_at: string;
  anomalies: number;
}

const tons: Record<Anomalie["severity"], "neutral" | "warning" | "danger"> = {
  info: "neutral",
  avertissement: "warning",
  bloquant: "danger",
};

export default function ImportSkaraPage() {
  const { db } = useData();
  const { notify } = useToast();
  const [nature, setNature] = useState<Nature>("liste_factures");
  const [magasin, setMagasin] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<ImportRecent[]>([]);

  const stores = db?.stores ?? [];
  const courant = natures.find((n) => n.key === nature)!;

  const charger = useCallback(async () => {
    try {
      const response = await fetch("/api/skara/import");
      const body = (await response.json()) as { imports?: ImportRecent[]; error?: string };
      if (response.ok) setRecents(body.imports ?? []);
    } catch {
      // L'historique est un confort : son échec ne bloque pas le dépôt.
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const envoyer = async (confirmer: boolean) => {
    if (!fichier) {
      notify("Choisissez d'abord un fichier.", "error");
      return;
    }
    if (courant.magasin && !magasin) {
      notify("Choisissez le magasin : Skara ne l'inscrit pas dans le fichier.", "error");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("fichier", fichier);
      form.set("nature", nature);
      if (magasin) form.set("magasin", magasin);
      if (confirmer) form.set("confirmer", "1");

      const response = await fetch("/api/skara/import", { method: "POST", body: form });
      const body = (await response.json()) as {
        error?: string;
        preview?: boolean;
        summary?: Resume;
        report?: {
          already_imported?: boolean;
          created?: number;
          updated?: number;
          rows_received?: number;
        };
      };
      if (body.summary) setResume(body.summary);
      if (!response.ok) {
        notify(body.error ?? "Lecture impossible.", "error");
        return;
      }
      if (body.preview) {
        notify(
          body.summary?.bloquant
            ? "Fichier refusé : corrigez l'anomalie bloquante avant d'importer."
            : "Fichier lu. Vérifiez les totaux, puis confirmez l'import.",
          body.summary?.bloquant ? "error" : "success",
        );
        return;
      }
      const r = body.report ?? {};
      notify(
        r.already_imported
          ? "Ce fichier a déjà été importé : rien n'a été réécrit."
          : `${r.rows_received ?? 0} ligne(s) lue(s) : ${r.created ?? 0} créée(s), ${r.updated ?? 0} mise(s) à jour.`,
      );
      setResume(null);
      setFichier(null);
      await charger();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Import Skara</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Skara reste l&apos;outil officiel. TRUST AI lit ses exports pour en
          tirer une vue interne, et ne lui écrit jamais rien. Aucune écriture
          n&apos;a lieu avant que vous ayez vu les totaux.
        </p>
      </div>

      <section
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium" htmlFor="nature">
              Nature du fichier
            </label>
            <select
              id="nature"
              value={nature}
              onChange={(e) => {
                setNature(e.target.value as Nature);
                setResume(null);
              }}
              className="mt-1 w-full rounded-lg border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            >
              {natures.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {courant.aide}
            </p>
          </div>

          {courant.magasin ? (
            <div>
              <label className="text-sm font-medium" htmlFor="magasin">
                Magasin
              </label>
              <select
                id="magasin"
                value={magasin}
                onChange={(e) => setMagasin(e.target.value)}
                className="mt-1 w-full rounded-lg border p-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg)" }}
              >
                <option value="">Choisir…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Skara exporte le magasin sélectionné dans sa propre session, sans
                l&apos;inscrire dans le fichier. Le préfixe du numéro de facture sert
                de contrôle quand il est configuré.
              </p>
            </div>
          ) : null}

          <div>
            <label className="text-sm font-medium" htmlFor="fichier">
              Fichier exporté
            </label>
            <input
              id="fichier"
              type="file"
              accept=".csv,.xls,.txt,text/csv,text/plain"
              onChange={(e) => {
                setFichier(e.target.files?.[0] ?? null);
                setResume(null);
              }}
              className="mt-1 w-full rounded-lg border p-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => envoyer(false)}
              disabled={busy || !fichier}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--border)" }}
            >
              <FileUp size={16} />
              {busy ? "Lecture…" : "Analyser sans écrire"}
            </button>
            <button
              type="button"
              onClick={() => envoyer(true)}
              disabled={busy || !resume || resume.bloquant}
              className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Confirmer l&apos;import
            </button>
          </div>
        </div>
      </section>

      {resume ? (
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <h2 className="font-semibold">Ce que contient le fichier</h2>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt style={{ color: "var(--muted)" }}>Lignes lues</dt>
              <dd className="font-semibold">{resume.lignes}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Période</dt>
              <dd className="font-semibold">
                {resume.periode.start
                  ? `${formatDate(resume.periode.start)} au ${formatDate(resume.periode.end ?? undefined)}`
                  : "non datée"}
              </dd>
            </div>
            {resume.prefixes.length > 0 ? (
              <div>
                <dt style={{ color: "var(--muted)" }}>Préfixes rencontrés</dt>
                <dd className="font-semibold">{resume.prefixes.join(", ")}</dd>
              </div>
            ) : null}
            {resume.pied ? (
              <div>
                <dt style={{ color: "var(--muted)" }}>Total du pied de fichier</dt>
                <dd className="font-semibold">
                  {Object.entries(resume.pied)
                    .filter(([, v]) => v !== null)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")}
                </dd>
              </div>
            ) : null}
          </dl>

          {resume.anomalies.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {resume.anomalies.map((anomalie, index) => (
                <li key={`${anomalie.kind}-${index}`} className="flex items-start gap-2 text-sm">
                  <Badge tone={tons[anomalie.severity]}>{anomalie.severity}</Badge>
                  <span>{anomalie.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Aucune anomalie. Les totaux du pied de fichier correspondent aux lignes.
            </p>
          )}
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 font-semibold">Imports récents</h2>
        {recents.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucun import"
            description="Déposez un premier export Skara pour commencer."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {recents.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border p-3 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--card)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {natures.find((n) => n.key === item.kind)?.label ?? item.kind}
                    {item.store_name ? ` — ${item.store_name}` : ""}
                  </span>
                  <span style={{ color: "var(--muted)" }}>
                    {formatDateTime(item.imported_at)}
                  </span>
                </div>
                <p style={{ color: "var(--muted)" }}>
                  {item.file_name} · {item.rows_received} ligne(s) ·{" "}
                  {item.rows_created} créée(s) · {item.rows_updated} mise(s) à jour
                  {item.anomalies > 0 ? ` · ${item.anomalies} anomalie(s)` : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
