"use client";

import { LIBELLES_ETAPE } from "@/lib/labo3d/etapes";
import { LIBELLES_MODE } from "@/lib/labo3d/fournisseurs";
import type { EtatScene, Selection } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — le panneau d'informations.
 *
 * Il reprend l'habillage de TRUST AI pour que la 3D soit perçue comme le
 * même logiciel, pas comme un objet rapporté. Toute valeur affichée ici est
 * FICTIVE, et le panneau le rappelle.
 */

function Ligne({ cle, valeur }: { cle: string; valeur: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12px] text-slate-400">{cle}</span>
      <span className="text-right text-[13px] font-medium text-slate-100">{valeur}</span>
    </div>
  );
}

function Titre({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </h3>
  );
}

export function Panneau({
  etat,
  selection,
  onFermer,
  source,
}: {
  source: "fictive" | "reelle";
  etat: EtatScene;
  selection: Selection;
  onFermer: () => void;
}) {
  const totalParEtape = etat.caisses.reduce<Record<string, number>>((acc, c) => {
    acc[c.etape] = (acc[c.etape] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <aside className="pointer-events-auto flex h-full w-[340px] flex-col gap-4 overflow-y-auto border-l border-white/10 bg-slate-900/90 p-4 backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-semibold text-white">Supervision</p>
          {/* Le sous-titre doit dire la vérité sur la source : afficher
              « données fictives » devant de vraies lignes serait pire que de
              ne rien afficher. */}
          {source === "reelle" ? (
            <p className="text-[11px] text-sky-300/90">
              Lignes logistiques réelles · lecture seule
            </p>
          ) : (
            <p className="text-[11px] text-amber-300/90">
              Jour simulé {etat.jour} · données fictives
            </p>
          )}
        </div>
        {selection && (
          <button
            onClick={onFermer}
            className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
          >
            Fermer
          </button>
        )}
      </div>

      {/* Vue d'ensemble, toujours visible. */}
      {!selection && (
        <section className="flex flex-col gap-1">
          <Titre>Répartition de la marchandise</Titre>
          <div className="mt-1 divide-y divide-white/5">
            {Object.entries(LIBELLES_ETAPE).map(([etape, libelle]) =>
              totalParEtape[etape] ? (
                <Ligne key={etape} cle={libelle} valeur={totalParEtape[etape]} />
              ) : null,
            )}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
            Cliquez un bâtiment, un camion ou une caisse. Cliquez un toit pour
            découvrir l&apos;intérieur d&apos;un dépôt.
          </p>
        </section>
      )}

      {selection?.genre === "depot" &&
        (() => {
          const d = etat.depots.find((x) => x.code === selection.code);
          if (!d) return null;
          const siennes = etat.caisses.filter((c) => c.depot === d.code);
          const stockees = siennes.filter((c) => c.etape === "disponible");
          const anomalies = siennes.filter((c) => c.anomalie);
          return (
            <section className="flex flex-col gap-1">
              <Titre>Dépôt</Titre>
              <p className="text-[15px] font-semibold text-white">{d.nom}</p>
              <p className="mb-2 text-[12px] leading-relaxed text-slate-400">{d.note}</p>
              <div className="divide-y divide-white/5">
                <Ligne cle="Ville" valeur={d.ville} />
                <Ligne cle="Marchandise rattachée" valeur={siennes.length} />
                <Ligne cle="En stock, disponible" valeur={stockees.length} />
                <Ligne
                  cle="Occupation"
                  valeur={`${Math.round((stockees.length / d.capacite) * 100)} %`}
                />
                <Ligne cle="Anomalies ouvertes" valeur={anomalies.length} />
              </div>
            </section>
          );
        })()}

      {selection?.genre === "caisse" &&
        (() => {
          const c = etat.caisses.find((x) => x.id === selection.id);
          if (!c) return null;
          return (
            <section className="flex flex-col gap-1">
              <Titre>Marchandise</Titre>
              <p className="text-[15px] font-semibold text-white">{c.designation}</p>
              <p className="mb-2 text-[12px] text-slate-400">Référence fictive {c.id}</p>
              <div className="divide-y divide-white/5">
                <Ligne cle="Étape" valeur={LIBELLES_ETAPE[c.etape]} />
                <Ligne cle="Quantité" valeur={c.quantite} />
                <Ligne cle="Fournisseur" valeur={c.fournisseur} />
                <Ligne cle="Dépôt de rattachement" valeur={c.depot === "argenteuil" ? "Argenteuil" : "La Penne-sur-Huveaune"} />
                <Ligne cle="Jours dans cette étape" valeur={c.joursDansEtape} />
                {c.clientPromis && <Ligne cle="Client promis" valeur={c.clientPromis} />}
              </div>
              {c.joursDansEtape >= 7 && !c.anomalie && (
                <p className="mt-3 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
                  Immobilisée depuis {c.joursDansEtape} jours — c&apos;est ce qu&apos;un
                  tableau ne fait pas ressortir.
                </p>
              )}
              {c.anomalie && (
                <p className="mt-3 rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
                  {c.anomalie}. Cette caisse ne progressera plus tant que
                  l&apos;anomalie n&apos;est pas levée.
                </p>
              )}
            </section>
          );
        })()}

      {selection?.genre === "vehicule" &&
        (() => {
          const v = etat.vehicules.find((x) => x.id === selection.id);
          if (!v) return null;
          const chargement = etat.caisses.filter((c) => c.vehiculeId === v.id);
          return (
            <section className="flex flex-col gap-1">
              <Titre>Véhicule</Titre>
              <p className="text-[15px] font-semibold text-white">{v.libelle}</p>
              <p className="mb-2 text-[12px] text-slate-400">
                Immatriculation fictive {v.immatriculation}
              </p>
              <div className="divide-y divide-white/5">
                <Ligne
                  cle="Rôle"
                  valeur={
                    v.role === "transfert"
                      ? "Affrètement entre dépôts"
                      : v.role === "livraison"
                        ? "Tournée de livraison"
                        : "Arrivage fournisseur"
                  }
                />
                {v.livreur && <Ligne cle="Livreur" valeur={v.livreur} />}
                <Ligne cle="Avancement du trajet" valeur={`${Math.round(v.progression * 100)} %`} />
                <Ligne cle="Caisses à bord" valeur={chargement.length} />
                {v.role === "livraison" && (
                  <Ligne cle="Passages restants" valeur={v.passagesRestants} />
                )}
              </div>
              {chargement.length > 0 && (
                <div className="mt-3">
                  <Titre>Chargement</Titre>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {chargement.slice(0, 8).map((c) => (
                      <li key={c.id} className="text-[12px] text-slate-300">
                        {c.designation}
                        <span className="text-slate-500"> × {c.quantite}</span>
                      </li>
                    ))}
                    {chargement.length > 8 && (
                      <li className="text-[12px] text-slate-500">
                        et {chargement.length - 8} autre(s)
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </section>
          );
        })()}

      {selection?.genre === "fournisseur" &&
        (() => {
          const f = etat.fournisseurs.find((x) => x.id === selection.id);
          if (!f) return null;
          const lignes = etat.caisses.filter((c) => c.fournisseur === f.nom);
          const bloquees = lignes.filter((c) => c.anomalie).length;
          return (
            <section className="flex flex-col gap-1">
              <Titre>Fournisseur</Titre>
              <p className="text-[15px] font-semibold text-white">{f.nom}</p>
              <p className="mb-2 text-[12px] leading-relaxed text-slate-400">
                Position schématique : la base ne renseigne ni adresse ni
                ville, seulement le pays.
              </p>
              <div className="divide-y divide-white/5">
                <Ligne cle="Pays" valeur={f.pays} />
                <Ligne cle="Logistique" valeur={LIBELLES_MODE[f.mode]} />
                <Ligne
                  cle="Délai annoncé"
                  valeur={f.delaiJours !== null ? `${f.delaiJours} jour(s)` : "non renseigné"}
                />
                <Ligne cle="Marchandise de ce fournisseur" valeur={lignes.length} />
                <Ligne cle="Dont bloquée" valeur={bloquees} />
              </div>
            </section>
          );
        })()}

      {selection?.genre === "magasin" &&
        (() => {
          const destinees = etat.caisses.filter(
            (c) => c.etape === "sortie" || c.etape === "disponible",
          );
          return (
            <section className="flex flex-col gap-1">
              <Titre>Magasin</Titre>
              <p className="text-[15px] font-semibold text-white">{selection.nom}</p>
              <p className="mb-2 text-[12px] leading-relaxed text-slate-400">
                Destination finale. Dans cette démonstration, les magasins ne
                portent pas de stock propre.
              </p>
              <div className="divide-y divide-white/5">
                <Ligne cle="Marchandise livrable en dépôt" valeur={destinees.length} />
              </div>
            </section>
          );
        })()}

      {/* Journal des événements simulés. */}
      <section className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-3">
        <Titre>Journal de simulation</Titre>
        <ul className="flex flex-col gap-1">
          {etat.journal.slice(0, 6).map((e, i) => (
            <li key={i} className="text-[12px] leading-snug text-slate-400">
              <span className="text-slate-500">J{e.jour} · </span>
              {e.texte}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
