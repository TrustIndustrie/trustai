"use client";

import Link from "next/link";
import { Archive, ExternalLink } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";

/**
 * Paramètres › Archives — phase 1.
 *
 * Les modules commerciaux recouverts par Skara sortent du menu principal mais
 * ne sont NI supprimés NI désactivés : leur code, leurs données et leurs URL
 * restent intacts. Cette page les rend accessibles en un clic, sans encombrer
 * la navigation quotidienne.
 */
const ARCHIVED = [
  {
    href: "/achats",
    label: "Achats fournisseurs",
    reason: "Les achats et les réceptions sont suivis dans Skara et dans le récapitulatif.",
  },
  {
    href: "/relances",
    label: "Relances du lundi",
    reason: "Suivi fournisseur assuré par le récapitulatif ; à réévaluer en phase ultérieure.",
  },
  {
    href: "/encaissements",
    label: "Encaissements et RAP",
    reason: "Règlements et facturation restent la vérité de Skara — aucune double comptabilité.",
  },
  {
    href: "/acquisition",
    label: "Acquisition marketing",
    reason: "Hors du périmètre logistique ; conservé pour l'historique des commandes web.",
  },
  {
    href: "/commandes/nouvelle-magasin",
    label: "Nouvelle commande magasin",
    reason: "Les commandes sont créées dans Skara : éviter toute double saisie.",
  },
];

export default function ArchivesPage() {
  const { mode } = useData();
  const { profile } = useSession();

  const allowed =
    mode === "demo" || (profile !== null && hasPermission(profile.role, "administrer"));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Archive size={20} aria-hidden style={{ color: "var(--primary)" }} />
          Archives
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Modules retirés du menu principal depuis le recentrage sur la
          logistique. Rien n&apos;a été supprimé : les données et les pages
          restent disponibles.
        </p>
      </div>

      {!allowed ? (
        <div className="card p-6 text-sm">
          <p>Cette page est réservée aux administrateurs.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {ARCHIVED.map((item) => (
            <li key={item.href} className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.label}</p>
                <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                  {item.reason}
                </p>
              </div>
              <Link href={item.href} className="btn-secondary">
                Ouvrir
                <ExternalLink size={15} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
