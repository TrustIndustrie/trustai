"use client";

import { useCallback, useEffect, useState } from "react";
import { Route, Truck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

/**
 * Tournées de livraison.
 *
 * Le lot précédent a donné la date au client. Celui-ci la tient : regrouper
 * les créneaux confirmés d'une journée, au départ d'un dépôt, dans un ordre
 * de passage.
 *
 * La règle que l'écran rend visible : on ne met pas dans la tournée du mardi
 * un client à qui on a promis le lundi. Les candidats proposés sont donc
 * uniquement ceux dont la date promise est celle de la tournée. Si une
 * incohérence apparaît malgré tout, le plan de route la signale en rouge
 * plutôt que de la laisser passer.
 */

interface Tournee {
  id: string;
  date: string;
  label: string;
  stage: string;
  vehicle_label: string | null;
  depot: string;
  livreur: string | null;
  passages: number;
  livres: number;
  manques: number;
}

interface Passage {
  id: string;
  position: number;
  statut: string;
  motif: string | null;
  dossier_id: string;
  reference: string;
  client: string | null;
  telephone: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  acces: string | null;
  fenetre: string | null;
  date_promise: string | null;
  date_incoherente: boolean;
}

interface Plan {
  id: string;
  date: string;
  label: string;
  stage: string;
  depot: string;
  warehouse_id: string;
  livreur: string | null;
  vehicle_label: string | null;
  notes: string | null;
  passages: Passage[];
}

interface Candidat {
  id: string;
  reference: string;
  client: string | null;
  ville: string | null;
  fenetre: string;
  disponibilite: string;
}

const ETAPES: Record<string, { label: string; ton: "neutral" | "info" | "success" | "warning" }> = {
  brouillon: { label: "Brouillon", ton: "neutral" },
  planifiee: { label: "Planifiée", ton: "info" },
  en_cours: { label: "En cours", ton: "warning" },
  terminee: { label: "Terminée", ton: "success" },
  annulee: { label: "Annulée", ton: "neutral" },
};

const FENETRES: Record<string, string> = {
  matin: "Matin",
  apres_midi: "Après-midi",
  journee: "Journée",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("fr-FR");
}

export default function TourneesPage() {
  const { notify } = useToast();
  const [tournees, setTournees] = useState<Tournee[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [candidats, setCandidats] = useState<Candidat[]>([]);
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    const res = await fetch("/api/tournees");
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? "Lecture impossible.", "error");
      setTournees([]);
      return;
    }
    setTournees(data.rows ?? []);
  }, [notify]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrir = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tournees?id=${id}`);
      const data = await res.json();
      if (!res.ok) {
        notify(data.error ?? "Tournée illisible.", "error");
        return;
      }
      const t: Plan = data.tournee;
      setPlan(t);
      setNote("");
      // Les dossiers encore chargeables ce jour-là, au départ de ce dépôt.
      const cres = await fetch(
        `/api/tournees?date=${t.date}&warehouse_id=${t.warehouse_id}`,
      );
      const cdata = await cres.json();
      setCandidats(cres.ok ? (cdata.candidats ?? []) : []);
    },
    [notify],
  );

  const agir = useCallback(
    async (corps: Record<string, unknown>, succes: string) => {
      setEnCours(true);
      try {
        const res = await fetch("/api/tournees", {
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
        if (plan) await ouvrir(plan.id);
      } finally {
        setEnCours(false);
      }
    },
    [charger, ouvrir, plan, notify],
  );

  const deplacer = useCallback(
    (index: number, sens: -1 | 1) => {
      if (!plan) return;
      const ordre = plan.passages.map((p) => p.id);
      const cible = index + sens;
      if (cible < 0 || cible >= ordre.length) return;
      [ordre[index], ordre[cible]] = [ordre[cible], ordre[index]];
      void agir(
        { action: "reordonner", tournee_id: plan.id, ordre },
        "Ordre de passage mis à jour.",
      );
    },
    [agir, plan],
  );

  if (!tournees) return <LoadingState />;

  const modifiable = plan && ["brouillon", "planifiee"].includes(plan.stage);
  const executable = plan && ["planifiee", "en_cours"].includes(plan.stage);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Tournées</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Seuls les dossiers dont la date promise est celle de la tournée
          peuvent y entrer. Une date promise ailleurs ne se charge pas ici.
        </p>
      </div>

      {tournees.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Aucune tournée"
          description="Une tournée se compose à partir des créneaux déjà confirmés avec les clients."
        />
      ) : (
        <section className="flex flex-col gap-2">
          {tournees.map((t) => {
            const etape = ETAPES[t.stage] ?? { label: t.stage, ton: "neutral" as const };
            return (
              <article
                key={t.id}
                className="rounded-lg border p-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => void ouvrir(t.id)}
                    className="text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    {formatDate(t.date)} — {t.label}
                  </button>
                  <Badge tone={etape.ton}>{etape.label}</Badge>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  {t.depot} · {t.passages} passage(s)
                  {t.livreur ? ` · ${t.livreur}` : " · aucun livreur affecté"}
                  {t.vehicle_label ? ` · ${t.vehicle_label}` : ""}
                  {t.livres > 0 ? ` · ${t.livres} livré(s)` : ""}
                  {t.manques > 0 ? ` · ${t.manques} manqué(s)` : ""}
                </p>
              </article>
            );
          })}
        </section>
      )}

      {plan && (
        <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {formatDate(plan.date)} — {plan.label}
            </h2>
            <button
              onClick={() => setPlan(null)}
              className="text-sm"
              style={{ color: "var(--muted)" }}
            >
              Fermer
            </button>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Départ {plan.depot}
            {plan.livreur ? ` · ${plan.livreur}` : " · aucun livreur affecté"}
            {plan.vehicle_label ? ` · ${plan.vehicle_label}` : ""}
          </p>

          <ol className="mt-3 flex flex-col gap-2">
            {plan.passages.map((p, i) => (
              <li
                key={p.id}
                className="rounded-md border p-2"
                style={{
                  borderColor: p.date_incoherente ? "var(--danger)" : "var(--border)",
                }}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{p.position}.</span>
                  <span>{p.client ?? p.reference}</span>
                  {p.ville ? (
                    <span style={{ color: "var(--muted)" }}>
                      {p.adresse ? `${p.adresse}, ` : ""}
                      {p.code_postal} {p.ville}
                    </span>
                  ) : null}
                  {p.fenetre ? <Badge tone="info">{FENETRES[p.fenetre] ?? p.fenetre}</Badge> : null}
                  {p.statut !== "prevu" ? (
                    <Badge tone={p.statut === "livre" ? "success" : "danger"}>{p.statut}</Badge>
                  ) : null}
                  {p.date_incoherente ? (
                    <Badge tone="danger">
                      Promis le {formatDate(p.date_promise)}, pas ce jour
                    </Badge>
                  ) : null}
                </div>
                {p.telephone ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {p.telephone}
                    {p.acces ? ` · ${p.acces}` : ""}
                  </p>
                ) : null}
                {p.motif ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {p.motif}
                  </p>
                ) : null}

                {p.statut === "prevu" && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    {modifiable && (
                      <>
                        <button onClick={() => deplacer(i, -1)} disabled={enCours || i === 0}>
                          ↑
                        </button>
                        <button
                          onClick={() => deplacer(i, 1)}
                          disabled={enCours || i === plan.passages.length - 1}
                        >
                          ↓
                        </button>
                        <button
                          disabled={enCours}
                          onClick={() =>
                            void agir(
                              { action: "retirer", passage_id: p.id },
                              "Passage retiré.",
                            )
                          }
                          className="underline-offset-2 hover:underline"
                        >
                          Retirer
                        </button>
                      </>
                    )}
                    {executable && (
                      <>
                        <button
                          disabled={enCours}
                          onClick={() =>
                            void agir(
                              { action: "resultat", passage_id: p.id, resultat: "livre" },
                              "Livraison enregistrée.",
                            )
                          }
                          className="underline-offset-2 hover:underline"
                        >
                          Livré
                        </button>
                        <button
                          disabled={enCours || note.trim() === ""}
                          title={note.trim() === "" ? "Indiquez un motif ci-dessous" : undefined}
                          onClick={() =>
                            void agir(
                              {
                                action: "resultat",
                                passage_id: p.id,
                                resultat: "echec",
                                note,
                              },
                              "Échec enregistré, le client est à rappeler.",
                            )
                          }
                          className="underline-offset-2 hover:underline"
                        >
                          Échec
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>

          {executable && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Motif, obligatoire pour un échec ou un report"
              className="mt-2 w-full rounded-md border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--border)" }}
            />
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {plan.stage === "brouillon" && (
              <button
                disabled={enCours}
                onClick={() =>
                  void agir(
                    { action: "planifier", tournee_id: plan.id },
                    "Tournée planifiée.",
                  )
                }
                className="rounded-md border px-3 py-1.5 text-sm font-medium"
                style={{ borderColor: "var(--border)" }}
              >
                Planifier
              </button>
            )}
            {plan.stage === "planifiee" && (
              <button
                disabled={enCours}
                onClick={() =>
                  void agir({ action: "demarrer", tournee_id: plan.id }, "Tournée démarrée.")
                }
                className="rounded-md border px-3 py-1.5 text-sm font-medium"
                style={{ borderColor: "var(--border)" }}
              >
                Le camion part
              </button>
            )}
          </div>

          {modifiable && (
            <div className="mt-4">
              <p className="text-sm font-medium">
                <Route size={14} className="mr-1 inline" aria-hidden />
                Dossiers chargeables ce jour-là
              </p>
              {candidats.length === 0 ? (
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  Aucun. Soit tout est déjà chargé, soit aucun client n&apos;attend sa
                  livraison ce jour-là depuis ce dépôt.
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {candidats.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span>{c.client ?? c.reference}</span>
                      <span style={{ color: "var(--muted)" }}>
                        {c.ville ?? ""} · {FENETRES[c.fenetre] ?? c.fenetre}
                      </span>
                      {c.disponibilite !== "complet" ? (
                        <Badge tone="warning">{c.disponibilite}</Badge>
                      ) : null}
                      <button
                        disabled={enCours}
                        onClick={() =>
                          void agir(
                            { action: "ajouter", tournee_id: plan.id, dossier_id: c.id },
                            "Passage ajouté.",
                          )
                        }
                        className="underline-offset-2 hover:underline"
                      >
                        Ajouter
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
