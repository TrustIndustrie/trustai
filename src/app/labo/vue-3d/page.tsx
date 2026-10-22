"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbitControls as ControlesType } from "three-stdlib";
import { Panneau } from "@/components/labo3d/Panneau";
import { Simulateur } from "@/components/labo3d/Simulateur";
import {
  avancerJour,
  creerEtatInitial,
  declencherAnomalie,
  livrerTournee,
  provoquerTransfert,
  reinitialiser,
} from "@/lib/labo3d/donnees-fictives";
import { useDonneesReelles, PLAFOND } from "@/components/labo3d/useDonneesReelles";
import { COULEURS_ETAPE, COULEUR_ANOMALIE, LIBELLES_ETAPE } from "@/lib/labo3d/etapes";
import type { CodeDepot, EtatScene, Selection } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — écran d'expérimentation.
 *
 * ⚠ PROTOTYPE. Deux sources, et DEUX SEULEMENT :
 *   - « Fictif » : tout est produit en mémoire, aucune connexion.
 *   - « Réel (lecture seule) » : une seule fonction serveur est appelée,
 *     `list_logistics_lines`, qui est déclarée `stable` — elle ne peut rien
 *     écrire. Aucune autre : ni validation, ni décision, ni envoi, ni
 *     écriture dans le Google Sheet. La simulation est éteinte dans ce mode.
 *
 * La scène est chargée par `next/dynamic` avec le rendu serveur désactivé :
 * three.js ne touche donc ni le bundle serveur, ni le JavaScript des autres
 * écrans de TRUST AI. Un utilisateur qui n'ouvre pas cette page ne télécharge
 * pas un octet de 3D.
 */

const Scene = dynamic(
  () => import("@/components/labo3d/Scene").then((m) => m.Scene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-900">
        <p className="text-sm text-slate-400">Chargement de la scène 3D…</p>
      </div>
    ),
  },
);

/** Les étapes affichées dans la légende, dans l'ordre du flux. */
const LEGENDE: (keyof typeof LIBELLES_ETAPE)[] = [
  "attendue",
  "recue_argenteuil",
  "en_transfert",
  "disponible",
  "sortie",
];

export default function LaboVue3dPage() {
  const [source, setSource] = useState<"fictive" | "reelle">("fictive");
  const [etatFictif, setEtatFictif] = useState<EtatScene>(() => creerEtatInitial());
  const { etat: chargementReel, recharger } = useDonneesReelles(source === "reelle");
  const [selection, setSelection] = useState<Selection>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [ouverts, setOuverts] = useState<Record<CodeDepot, boolean>>({
    argenteuil: false,
    aubagne: false,
  });
  const [lecture, setLecture] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [nuit, setNuit] = useState(false);
  const [circulation, setCirculation] = useState(false);
  const [vitesse, setVitesse] = useState(1);
  const controles = useRef<ControlesType>(null);

  const sceneReelle = chargementReel.phase === "pret" ? chargementReel.scene : null;

  // La scène affichée. En mode réel tant que la lecture n'a pas abouti, on
  // montre un plateau VIDE plutôt que les caisses fictives : voir des données
  // inventées sous l'étiquette « réel » serait le pire défaut possible.
  const etat: EtatScene =
    source === "reelle"
      ? (sceneReelle?.etat ?? { ...etatFictif, caisses: [], vehicules: [], anomalies: [], journal: [] })
      : etatFictif;

  // Lecture automatique : un jour simulé toutes les 1,6 s à vitesse 1.
  // Jamais en données réelles : il n'y a pas de jour à faire avancer.
  useEffect(() => {
    if (!lecture || source === "reelle") return;
    const periode = Math.max(250, 1600 / vitesse);
    const minuteur = setInterval(() => setEtatFictif((e) => avancerJour(e)), periode);
    return () => clearInterval(minuteur);
  }, [lecture, vitesse, source]);

  // Changer de source remet la sélection à plat : un identifiant fictif ne
  // désigne rien dans les vraies lignes, et inversement.
  useEffect(() => {
    setSelection(null);
    setSurvol(null);
    setLecture(false);
  }, [source]);

  const basculerToit = useCallback((code: CodeDepot) => {
    setOuverts((o) => ({ ...o, [code]: !o[code] }));
  }, []);

  const vueGenerale = useCallback(() => {
    const c = controles.current;
    if (!c) return;
    c.target.set(0, 0, -12);
    c.object.position.set(86, 72, 86);
    c.update();
  }, []);

  const toutReinitialiser = useCallback(() => {
    setEtatFictif(reinitialiser());
    setSelection(null);
    setSurvol(null);
    setOuverts({ argenteuil: false, aubagne: false });
    setLecture(false);
    vueGenerale();
  }, [vueGenerale]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-900">
      {/* Bandeau d'avertissement : on ne doit jamais confondre ce prototype
          avec l'application réelle. */}
      <div
        className={`flex items-center justify-between gap-3 border-b px-4 py-1.5 ${
          source === "reelle"
            ? "border-sky-400/30 bg-sky-400/10"
            : "border-amber-400/30 bg-amber-400/10"
        }`}
      >
        <p
          className={`text-[12px] font-medium ${
            source === "reelle" ? "text-sky-200" : "text-amber-200"
          }`}
        >
          {source === "reelle" ? (
            <>
              Laboratoire expérimental — <strong>vraies lignes logistiques, en
              lecture seule</strong>. Une seule fonction serveur est appelée
              (<code>list_logistics_lines</code>) : aucune écriture, aucune
              décision, aucun envoi, rien dans le Google Sheet. Les
              fournisseurs réunissent le référentiel et les noms portés par
              les lignes du récapitulatif. La simulation est désactivée.
            </>
          ) : (
            <>
              Laboratoire expérimental — données entièrement fictives.{" "}
              <strong>Les noms de fournisseurs, de clients et de produits
              sont inventés</strong> : les vrais n&apos;apparaissent qu&apos;en
              mode réel. Aucune connexion à Supabase, aucune écriture, aucun
              lien avec la production.
            </>
          )}
        </p>
        {/* Le lien vers la vue dépôt. Sans lui, la page détaillée n'était
            atteignable qu'en tapant son adresse — et personne ne tape une
            adresse devant quelqu'un. */}
        <a
          href="/labo/depot-la-penne"
          className="whitespace-nowrap rounded border border-white/25 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/10"
        >
          Entrer dans le dépôt de La Penne →
        </a>
        <a
          href="/dashboard"
          className={`whitespace-nowrap rounded border px-2 py-0.5 text-[11px] ${
            source === "reelle"
              ? "border-sky-400/40 text-sky-100 hover:bg-sky-400/15"
              : "border-amber-400/40 text-amber-100 hover:bg-amber-400/15"
          }`}
        >
          Quitter le laboratoire
        </a>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div
          className="relative min-w-0 flex-1"
          // Le ciel est peint derrière le canvas, qui est transparent :
          // l'horizon rend la profondeur que la projection orthographique
          // supprime.
          style={{
            background: nuit
              ? "linear-gradient(180deg,#0d1424 0%,#16202f 55%,#1d2430 100%)"
              : "linear-gradient(180deg,#dbe6f0 0%,#e9eeea 52%,#e4e0d5 100%)",
          }}
        >
          <Scene
            etat={etat}
            selection={selection}
            survol={survol}
            ouverts={ouverts}
            presentation={presentation}
            nuit={nuit}
            circulation={circulation}
            controles={controles}
            onSelection={setSelection}
            onSurvol={setSurvol}
            onBasculerToit={basculerToit}
          />

          {/* Légende des couleurs, posée sur la scène. */}
          <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2.5 backdrop-blur-md">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Étape de la marchandise
            </p>
            <ul className="flex flex-col gap-1">
              {LEGENDE.map((etape) => (
                <li key={etape} className="flex items-center gap-2 text-[12px] text-slate-200">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: COULEURS_ETAPE[etape] }}
                  />
                  {LIBELLES_ETAPE[etape]}
                </li>
              ))}
              <li className="flex items-center gap-2 text-[12px] text-slate-200">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: COULEUR_ANOMALIE }}
                />
                Anomalie bloquante
              </li>
            </ul>
            <p className="mt-2 max-w-[190px] text-[11px] leading-snug text-slate-500">
              Chariots, ouvriers et arbres sont décoratifs : ils ne portent
              aucune donnée.
            </p>

            {/* Ce que la base ne dit PAS. À dire à l'écran, pas à maquiller. */}
            {source === "reelle" && sceneReelle && (
              <p className="mt-2 max-w-[190px] border-t border-white/10 pt-2 text-[11px] leading-snug text-sky-300/80">
                {sceneReelle.converties} ligne(s) sur {sceneReelle.total}
                {sceneReelle.total > PLAFOND ? ` (plafond ${PLAFOND})` : ""}.
                Le « % occupé » repose sur une capacité estimée, et la position
                des camions sur la route est indicative : la base ne porte ni
                l&apos;une ni l&apos;autre.
              </p>
            )}
          </div>

          {/* Base lue, mais vide. À DIRE : un plateau vide sans explication
              se lit comme une panne, alors que c'est une information — la
              table `logistics_lines` ne contient rien pour cette
              organisation. */}
          {source === "reelle" && sceneReelle?.converties === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="max-w-md rounded-lg border border-white/15 bg-slate-900/90 px-5 py-4 text-center backdrop-blur-md">
                <p className="text-sm font-medium text-slate-200">
                  Aucune donnée logistique
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">
                  La lecture a abouti, mais elle ne renvoie aucune ligne : la
                  table <code>logistics_lines</code> est vide pour votre
                  organisation. Ce n&apos;est pas une panne du prototype.
                </p>
              </div>
            </div>
          )}

          {/* État de la lecture réelle : chargement, refus, erreur. */}
          {source === "reelle" && chargementReel.phase !== "pret" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="pointer-events-auto max-w-md rounded-lg border border-white/15 bg-slate-900/90 px-5 py-4 text-center backdrop-blur-md">
                {chargementReel.phase === "chargement" && (
                  <p className="text-sm text-slate-300">
                    Lecture des lignes logistiques…
                  </p>
                )}
                {(chargementReel.phase === "refus" ||
                  chargementReel.phase === "erreur") && (
                  <>
                    <p className="text-sm font-medium text-amber-200">
                      {chargementReel.phase === "refus"
                        ? "Lecture impossible"
                        : "La lecture a échoué"}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">
                      {chargementReel.message}
                    </p>
                    <button
                      onClick={() => setSource("fictive")}
                      className="mt-3 rounded border border-white/20 px-2.5 py-1 text-[12px] text-slate-200 hover:bg-white/10"
                    >
                      Revenir aux données fictives
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Aide à la navigation. */}
          <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-white/10 bg-slate-900/75 px-3 py-2 text-[11px] leading-relaxed text-slate-400 backdrop-blur-md">
            Glisser pour pivoter · molette pour zoomer · clic droit pour
            déplacer · cliquer un toit pour voir l&apos;intérieur
          </div>
        </div>

        <Panneau
          etat={etat}
          selection={selection}
          source={source}
          onFermer={() => setSelection(null)}
        />
      </div>

      <Simulateur
        source={source}
        onSource={setSource}
        chargement={chargementReel.phase === "chargement"}
        presentation={presentation}
        onPresentation={() => setPresentation((p) => !p)}
        nuit={nuit}
        onNuit={() => setNuit((n) => !n)}
        circulation={circulation}
        onCirculation={() => setCirculation((c) => !c)}
        jour={etat.jour}
        lecture={lecture}
        vitesse={vitesse}
        ouverts={ouverts}
        onJourSuivant={() => setEtatFictif((e) => avancerJour(e))}
        onLecture={() => setLecture((l) => !l)}
        onVitesse={setVitesse}
        onTransfert={() => setEtatFictif((e) => provoquerTransfert(e))}
        onAnomalie={() => setEtatFictif((e) => declencherAnomalie(e))}
        onLivrer={() => setEtatFictif((e) => livrerTournee(e))}
        onReinitialiser={toutReinitialiser}
        onBasculerToit={basculerToit}
        onVueGenerale={vueGenerale}
        onRecharger={() => void recharger()}
      />
    </div>
  );
}
