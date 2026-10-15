"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, PackageCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

/**
 * Promesse de date au client.
 *
 * C'est l'écran qui ferme le vrai goulot : savoir, sans croiser deux autres
 * écrans de tête, quels dossiers sont réellement livrables, puis convenir
 * d'une date et la garder.
 *
 * La disponibilité n'est jamais stockée, elle est recalculée à chaque
 * lecture : une marchandise qui bouge dans le récapitulatif change l'écran
 * aussitôt, sans rafraîchissement à déclencher.
 *
 * TRUST AI N'ENVOIE RIEN. Enregistrer des créneaux ne prévient pas le
 * client : c'est un humain qui appelle, et c'est voulu.
 */

type Readiness = "complet" | "partiel" | "rien_de_dispo" | "sans_ligne";

interface Dossier {
  id: string;
  reference: string;
  stage: string;
  remise_type: string | null;
  expected_ready_at: string | null;
  priorite: number;
  customer_name: string | null;
  city: string | null;
  depot: string | null;
  magasin: string | null;
  contact_authorized_at: string | null;
  contact_authorized_partial: boolean;
  readiness: Readiness;
  lignes_total: number;
  lignes_pretes: number;
  lignes_manquantes: number;
  creneau_retenu: { date: string; fenetre: string } | null;
  creneaux_proposes: number;
}

interface Totaux {
  dossiers: number;
  prets?: number;
  partiels?: number;
  sans_ligne?: number;
  a_contacter?: number;
  contact_en_cours?: number;
  creneau_confirme?: number;
}

interface LigneDetail {
  allocation_id: string;
  designation: string;
  quantite_affectee: number;
  quantite_livree: number;
  statut_affectation: string;
  etape_ligne: string;
  depot_actuel: string | null;
  arrivee_prevue: string | null;
  prete: boolean;
}

interface CreneauDetail {
  id: string;
  date: string;
  fenetre: string;
  rang: number;
  statut: string;
  notes: string | null;
}

interface Detail {
  id: string;
  reference: string;
  stage: string;
  depot: string | null;
  contact_authorized_at: string | null;
  contact_authorized_partial: boolean;
  contact_authorization_note: string | null;
  disponibilite: {
    readiness: Readiness;
    lignes_total: number;
    lignes_pretes: number;
    lignes_manquantes: number;
  };
  lignes: LigneDetail[];
  creneaux: CreneauDetail[];
}

const ETAPES: Record<string, string> = {
  a_rapprocher: "À rapprocher",
  incomplet: "Incomplet",
  pret_a_contacter: "Prêt à contacter",
  contact_en_cours: "Contact en cours",
  creneau_confirme: "Créneau confirmé",
  planifie: "Planifié",
  en_cours: "En cours",
  termine: "Terminé",
};

const FENETRES: Record<string, string> = {
  matin: "Matin",
  apres_midi: "Après-midi",
  journee: "Journée",
};

const DISPONIBILITE: Record<Readiness, { label: string; ton: "success" | "warning" | "danger" | "neutral" }> = {
  complet: { label: "Tout est là", ton: "success" },
  partiel: { label: "Partiel", ton: "warning" },
  rien_de_dispo: { label: "Rien de disponible", ton: "danger" },
  sans_ligne: { label: "Aucune marchandise", ton: "neutral" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("fr-FR");
}

/** Trois dates ouvrées à partir d'après-demain : un point de départ, pas une contrainte. */
function creneauxParDefaut(): { date: string; fenetre: string; rang: number }[] {
  const out: { date: string; fenetre: string; rang: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (out.length < 3) {
    const jour = d.getDay();
    if (jour !== 0) {
      out.push({
        date: d.toISOString().slice(0, 10),
        fenetre: out.length === 1 ? "apres_midi" : "matin",
        rang: out.length + 1,
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function LivraisonsPage() {
  const { notify } = useToast();
  const [totaux, setTotaux] = useState<Totaux | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [filtre, setFiltre] = useState<string>("");
  const [ouvert, setOuvert] = useState<Detail | null>(null);
  const [creneaux, setCreneaux] = useState(creneauxParDefaut);
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    const params = filtre ? `?readiness=${filtre}` : "";
    const res = await fetch(`/api/livraisons${params}`);
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? "Lecture impossible.", "error");
      setTotaux({ dossiers: 0 });
      return;
    }
    setTotaux(data.totals ?? { dossiers: 0 });
    setDossiers(data.rows ?? []);
  }, [filtre, notify]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrir = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/livraisons?id=${id}`);
      const data = await res.json();
      if (!res.ok) {
        notify(data.error ?? "Dossier illisible.", "error");
        return;
      }
      setOuvert(data.dossier);
      setNote("");
      setCreneaux(creneauxParDefaut());
    },
    [notify],
  );

  const agir = useCallback(
    async (corps: Record<string, unknown>, succes: string) => {
      setEnCours(true);
      try {
        const res = await fetch("/api/livraisons", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(corps),
        });
        const data = await res.json();
        if (!res.ok) {
          notify(data.error ?? "Action refusée.", "error");
          return;
        }
        notify(succes, "success");
        await charger();
        if (ouvert) await ouvrir(ouvert.id);
      } finally {
        setEnCours(false);
      }
    },
    [charger, ouvert, ouvrir, notify],
  );

  if (!totaux) return <LoadingState />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Livraisons à organiser</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          La disponibilité est recalculée à chaque ouverture : elle suit le
          récapitulatif sans décalage. Enregistrer des créneaux ne prévient
          personne — c&apos;est vous qui appelez le client.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { cle: "", label: `Tous (${totaux.dossiers})` },
          { cle: "complet", label: `Tout est là (${totaux.prets ?? 0})` },
          { cle: "partiel", label: `Partiels (${totaux.partiels ?? 0})` },
          { cle: "sans_ligne", label: `Sans marchandise (${totaux.sans_ligne ?? 0})` },
        ].map((f) => (
          <button
            key={f.cle}
            onClick={() => setFiltre(f.cle)}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{
              borderColor: "var(--border)",
              background: filtre === f.cle ? "var(--accent-soft)" : "transparent",
              fontWeight: filtre === f.cle ? 600 : 400,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {dossiers.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Aucun dossier"
          description="Les dossiers de livraison apparaissent une fois la marchandise affectée."
        />
      ) : (
        <section className="flex flex-col gap-2">
          {dossiers.map((d) => {
            const dispo = DISPONIBILITE[d.readiness];
            return (
              <article
                key={d.id}
                className="rounded-lg border p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <button
                      onClick={() => void ouvrir(d.id)}
                      className="text-sm font-semibold underline-offset-2 hover:underline"
                    >
                      {d.reference}
                    </button>
                    <span className="ml-2 text-sm" style={{ color: "var(--muted)" }}>
                      {d.customer_name ?? "Client non renseigné"}
                      {d.city ? ` — ${d.city}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={dispo.ton}>{dispo.label}</Badge>
                    <Badge tone="neutral">{ETAPES[d.stage] ?? d.stage}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  {d.lignes_pretes} ligne(s) prête(s) sur {d.lignes_total}
                  {d.depot ? ` · départ ${d.depot}` : ""}
                  {d.creneau_retenu
                    ? ` · livraison le ${formatDate(d.creneau_retenu.date)} (${
                        FENETRES[d.creneau_retenu.fenetre] ?? d.creneau_retenu.fenetre
                      })`
                    : d.creneaux_proposes > 0
                      ? ` · ${d.creneaux_proposes} créneau(x) proposé(s), en attente de réponse`
                      : ""}
                </p>
              </article>
            );
          })}
        </section>
      )}

      {ouvert && (
        <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {ouvert.reference} — {ETAPES[ouvert.stage] ?? ouvert.stage}
            </h2>
            <button
              onClick={() => setOuvert(null)}
              className="text-sm"
              style={{ color: "var(--muted)" }}
            >
              Fermer
            </button>
          </div>

          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {ouvert.disponibilite.lignes_pretes} sur {ouvert.disponibilite.lignes_total} ligne(s)
            disponible(s){ouvert.depot ? ` au départ de ${ouvert.depot}` : ""}.
            {ouvert.contact_authorized_at
              ? ` Contact autorisé le ${formatDate(ouvert.contact_authorized_at)}${
                  ouvert.contact_authorized_partial ? ", livraison partielle assumée" : ""
                }.`
              : " Contact non encore autorisé."}
          </p>

          <ul className="mt-3 flex flex-col gap-1">
            {ouvert.lignes.map((l) => (
              <li key={l.allocation_id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={l.prete ? "success" : "warning"}>
                  {l.prete ? "Prête" : "En attente"}
                </Badge>
                <span>{l.designation}</span>
                <span style={{ color: "var(--muted)" }}>
                  × {l.quantite_affectee} · {l.etape_ligne}
                  {l.depot_actuel ? ` · ${l.depot_actuel}` : ""}
                  {!l.prete && l.arrivee_prevue
                    ? ` · attendue le ${formatDate(l.arrivee_prevue)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>

          {!ouvert.contact_authorized_at && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-sm font-medium">Autoriser le contact du client</p>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note de validation (facultative)"
                className="rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={enCours}
                  onClick={() =>
                    void agir(
                      { action: "autoriser", dossier_id: ouvert.id, note },
                      "Contact autorisé.",
                    )
                  }
                  className="rounded-md border px-3 py-1.5 text-sm font-medium"
                  style={{ borderColor: "var(--border)" }}
                >
                  Autoriser
                </button>
                {ouvert.disponibilite.readiness === "partiel" && (
                  <button
                    disabled={enCours}
                    onClick={() =>
                      void agir(
                        {
                          action: "autoriser",
                          dossier_id: ouvert.id,
                          note,
                          accepter_partiel: true,
                        },
                        "Contact autorisé en livraison partielle.",
                      )
                    }
                    className="rounded-md border px-3 py-1.5 text-sm font-medium"
                    style={{ borderColor: "var(--border)" }}
                  >
                    Autoriser malgré {ouvert.disponibilite.lignes_manquantes} ligne(s) manquante(s)
                  </button>
                )}
              </div>
            </div>
          )}

          {ouvert.contact_authorized_at && ouvert.stage !== "creneau_confirme" && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-sm font-medium">Créneaux à proposer au client</p>
              {creneaux.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={c.date}
                    onChange={(e) => {
                      const next = [...creneaux];
                      next[i] = { ...c, date: e.target.value };
                      setCreneaux(next);
                    }}
                    className="rounded-md border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  />
                  <select
                    value={c.fenetre}
                    onChange={(e) => {
                      const next = [...creneaux];
                      next[i] = { ...c, fenetre: e.target.value };
                      setCreneaux(next);
                    }}
                    className="rounded-md border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <option value="matin">Matin</option>
                    <option value="apres_midi">Après-midi</option>
                    <option value="journee">Journée</option>
                  </select>
                </div>
              ))}
              <button
                disabled={enCours}
                onClick={() =>
                  void agir(
                    { action: "proposer", dossier_id: ouvert.id, creneaux, note },
                    "Créneaux enregistrés. Aucun message n'a été envoyé.",
                  )
                }
                className="self-start rounded-md border px-3 py-1.5 text-sm font-medium"
                style={{ borderColor: "var(--border)" }}
              >
                Enregistrer ces créneaux
              </button>
            </div>
          )}

          {ouvert.creneaux.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">Historique des créneaux</p>
              <ul className="mt-1 flex flex-col gap-1">
                {ouvert.creneaux.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <CalendarClock size={14} aria-hidden />
                    <span>
                      {formatDate(c.date)} · {FENETRES[c.fenetre] ?? c.fenetre}
                    </span>
                    <Badge
                      tone={
                        c.statut === "retenue"
                          ? "success"
                          : c.statut === "proposee"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {c.statut}
                    </Badge>
                    {c.statut === "proposee" && (
                      <button
                        disabled={enCours}
                        onClick={() =>
                          void agir(
                            { action: "confirmer", creneau_id: c.id, note },
                            "Créneau confirmé avec le client.",
                          )
                        }
                        className="text-sm underline-offset-2 hover:underline"
                      >
                        Le client accepte
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {ouvert.stage === "contact_en_cours" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Motif du refus ou de l'échec d'appel"
                    className="rounded-md border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  />
                  <button
                    disabled={enCours}
                    onClick={() =>
                      void agir(
                        { action: "refuser", dossier_id: ouvert.id, note },
                        "Créneaux refusés, dossier rendu au contact.",
                      )
                    }
                    className="rounded-md border px-3 py-1.5 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  >
                    Aucun créneau ne convient
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
