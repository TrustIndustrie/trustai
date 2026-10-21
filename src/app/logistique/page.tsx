"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, PackageSearch, RefreshCw } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { StatCard } from "@/components/ui/StatCard";
import { LoadingState } from "@/components/ui/LoadingState";
import { hasPermission } from "@/lib/permissions";
import type { LogisticsSummary } from "@/lib/types";

/**
 * Page « Logistique » — phase 1.
 *
 * Le socle de données existe (13 tables, sécurisées), mais la lecture du
 * récapitulatif (phase 2) et le traitement des factures (phase 3) ne sont pas
 * encore branchés : les compteurs sont donc à zéro. Cette page rend le socle
 * visible et vérifiable, et sert de point d'accroche aux phases suivantes.
 *
 * Les chiffres proviennent de la fonction serveur `logistics_summary()` :
 * aucune table logistique n'est lisible directement depuis le navigateur.
 */
export default function LogistiquePage() {
  const { mode, logisticsSummary } = useData();
  const { profile, loading } = useSession();
  const [summary, setSummary] = useState<LogisticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canRead =
    mode === "demo" ||
    (profile !== null &&
      (hasPermission(profile.role, "gerer_livraisons") ||
        hasPermission(profile.role, "gerer_logistique")));

  useEffect(() => {
    let cancelled = false;
    if (mode !== "connected" || !canRead) return;
    setBusy(true);
    logisticsSummary()
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Lecture impossible.");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, canRead, logisticsSummary]);

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <PackageSearch size={20} aria-hidden style={{ color: "var(--primary)" }} />
          Logistique
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Suivi des marchandises, dossiers de livraison et retraits.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/logistique/lignes" className="btn-primary">
          <PackageSearch size={16} aria-hidden />
          Lignes du récapitulatif
        </Link>
        <Link href="/logistique/recap" className="btn-secondary">
          <FileSpreadsheet size={16} aria-hidden />
          Configurer le récapitulatif
        </Link>
      </div>

      <div
        className="card p-4 text-sm"
        style={{ borderColor: "var(--primary)", background: "var(--primary-soft)" }}
        role="status"
      >
        <p className="font-semibold">Suivi des marchandises actif</p>
        <p className="mt-1">
          Le fichier récapitulatif alimente les lignes logistiques : arrivées,
          transferts Argenteuil → Aubagne et disponibilité. Le rapprochement
          avec les factures Skara et la prise de rendez-vous client arrivent
          aux phases suivantes.
        </p>
      </div>

      {mode === "demo" ? (
        <div className="card p-6 text-sm">
          <p>
            L&apos;application fonctionne en <strong>mode démonstration</strong> :
            le module logistique s&apos;appuie sur la base partagée et n&apos;est
            actif qu&apos;en mode connecté.
          </p>
        </div>
      ) : !canRead ? (
        <div className="card p-6 text-sm">
          <p>Votre rôle ne donne pas accès au suivi logistique.</p>
        </div>
      ) : error ? (
        <div
          className="card p-4 text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
          role="alert"
        >
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Lignes suivies"
            value={busy ? "…" : String(summary?.lignesTotal ?? 0)}
            icon={PackageSearch}
          />
          <StatCard
            label="Articles disponibles"
            value={busy ? "…" : String(summary?.lignesDisponibles ?? 0)}
            icon={PackageSearch}
            tone="success"
          />
          <StatCard
            label="Dossiers de livraison"
            value={busy ? "…" : String(summary?.dossiersTotal ?? 0)}
            icon={RefreshCw}
          />
          <StatCard
            label="Prêts à contacter"
            value={busy ? "…" : String(summary?.dossiersAContacter ?? 0)}
            icon={RefreshCw}
            tone="success"
          />
          <StatCard
            label="Documents à vérifier"
            value={busy ? "…" : String(summary?.documentsAVerifier ?? 0)}
            icon={RefreshCw}
          />
          <StatCard
            label="Anomalies ouvertes"
            value={busy ? "…" : String(summary?.anomaliesOuvertes ?? 0)}
            icon={RefreshCw}
            tone={summary && summary.anomaliesOuvertes > 0 ? "danger" : undefined}
          />
        </div>
      )}
    </div>
  );
}
