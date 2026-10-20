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
import { COULEURS_ETAPE, COULEUR_ANOMALIE, LIBELLES_ETAPE } from "@/lib/labo3d/etapes";
import type { CodeDepot, EtatScene, Selection } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — écran d'expérimentation.
 *
 * ⚠ PROTOTYPE. Cet écran n'appelle ni Supabase ni aucun service : toutes les
 * données sont fictives et produites en mémoire. Rien n'est écrit nulle part.
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
  const [etat, setEtat] = useState<EtatScene>(() => creerEtatInitial());
  const [selection, setSelection] = useState<Selection>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [ouverts, setOuverts] = useState<Record<CodeDepot, boolean>>({
    argenteuil: false,
    aubagne: false,
  });
  const [lecture, setLecture] = useState(false);
  const [vitesse, setVitesse] = useState(1);
  const controles = useRef<ControlesType>(null);

  // Lecture automatique : un jour simulé toutes les 1,6 s à vitesse 1.
  useEffect(() => {
    if (!lecture) return;
    const periode = Math.max(250, 1600 / vitesse);
    const minuteur = setInterval(() => setEtat((e) => avancerJour(e)), periode);
    return () => clearInterval(minuteur);
  }, [lecture, vitesse]);

  const basculerToit = useCallback((code: CodeDepot) => {
    setOuverts((o) => ({ ...o, [code]: !o[code] }));
  }, []);

  const vueGenerale = useCallback(() => {
    const c = controles.current;
    if (!c) return;
    c.target.set(0, 0, 0);
    c.object.position.set(60, 52, 60);
    c.update();
  }, []);

  const toutReinitialiser = useCallback(() => {
    setEtat(reinitialiser());
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
      <div className="flex items-center justify-between gap-3 border-b border-amber-400/30 bg-amber-400/10 px-4 py-1.5">
        <p className="text-[12px] font-medium text-amber-200">
          Laboratoire expérimental — données entièrement fictives. Aucune
          connexion à Supabase, aucune écriture, aucun lien avec la production.
        </p>
        <a
          href="/dashboard"
          className="whitespace-nowrap rounded border border-amber-400/40 px-2 py-0.5 text-[11px] text-amber-100 hover:bg-amber-400/15"
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
            background:
              "linear-gradient(180deg,#dbe6f0 0%,#e9eeea 52%,#e4e0d5 100%)",
          }}
        >
          <Scene
            etat={etat}
            selection={selection}
            survol={survol}
            ouverts={ouverts}
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
          </div>

          {/* Aide à la navigation. */}
          <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-white/10 bg-slate-900/75 px-3 py-2 text-[11px] leading-relaxed text-slate-400 backdrop-blur-md">
            Glisser pour pivoter · molette pour zoomer · clic droit pour
            déplacer · cliquer un toit pour voir l&apos;intérieur
          </div>
        </div>

        <Panneau etat={etat} selection={selection} onFermer={() => setSelection(null)} />
      </div>

      <Simulateur
        jour={etat.jour}
        lecture={lecture}
        vitesse={vitesse}
        ouverts={ouverts}
        onJourSuivant={() => setEtat((e) => avancerJour(e))}
        onLecture={() => setLecture((l) => !l)}
        onVitesse={setVitesse}
        onTransfert={() => setEtat((e) => provoquerTransfert(e))}
        onAnomalie={() => setEtat((e) => declencherAnomalie(e))}
        onLivrer={() => setEtat((e) => livrerTournee(e))}
        onReinitialiser={toutReinitialiser}
        onBasculerToit={basculerToit}
        onVueGenerale={vueGenerale}
      />
    </div>
  );
}
