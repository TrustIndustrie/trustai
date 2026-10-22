"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { OrbitControls as ControlesType } from "three-stdlib";
import { INCERTITUDES, PENNE } from "@/lib/labo3d/depot-penne";
import {
  VUES_LOCALES,
  versLeMonde,
  type VuePenne,
} from "@/lib/labo3d/vues-penne";

/**
 * LABORATOIRE 3D — le dépôt de La Penne-sur-Huveaune, à l'échelle réelle.
 *
 * ⚠ VUE SÉPARÉE, ET C'EST VOLONTAIRE. Le bâtiment fait cent mètres de long :
 * à cette échelle il écraserait la carte d'ensemble, où Argenteuil tient en
 * trente unités. Les deux vues ne se concurrencent pas, elles répondent à
 * deux questions différentes — « où est la marchandise dans le réseau » et
 * « à quoi ressemble ce dépôt ».
 *
 * Aucune donnée métier ici : la page ne lit ni Supabase, ni le récapitulatif,
 * ni quoi que ce soit. Elle dessine une géométrie décrite à la main, et elle
 * affiche sans détour ce qui reste incertain.
 */

const Scene = dynamic(
  () => import("@/components/labo3d/ScenePenne").then((m) => m.ScenePenne),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-900">
        <p className="text-sm text-slate-400">Chargement du dépôt…</p>
      </div>
    ),
  },
);

export default function DepotLaPennePage() {
  const [vue, setVue] = useState<VuePenne>("entree");
  const [ouvert, setOuvert] = useState(true);
  const controles = useRef<ControlesType>(null);

  const allerA = useCallback((v: VuePenne) => {
    setVue(v);
    const c = controles.current;
    if (!c) return;
    const position = versLeMonde(VUES_LOCALES[v].position);
    const cible = versLeMonde(VUES_LOCALES[v].cible);
    c.object.position.set(position[0], position[1], position[2]);
    c.target.set(cible[0], cible[1], cible[2]);
    c.update();
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-amber-400/30 bg-amber-400/10 px-4 py-1.5">
        <p className="text-[12px] font-medium text-amber-200">
          Reconstitution du dépôt de La Penne-sur-Huveaune — d&apos;après la
          description de Farouk, 22 octobre 2026.{" "}
          <strong>Ce n&apos;est pas un relevé de géomètre</strong> : les mesures
          non confirmées sont listées en bas à gauche.
        </p>
        <a
          href="/labo/vue-3d"
          className="whitespace-nowrap rounded border border-amber-400/40 px-2 py-0.5 text-[11px] text-amber-100 hover:bg-amber-400/15"
        >
          ← Vue d&apos;ensemble
        </a>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div
          className="relative min-w-0 flex-1"
          style={{
            background: "linear-gradient(180deg,#dbe6f0 0%,#e9eeea 52%,#e4e0d5 100%)",
          }}
        >
          <Scene ouvert={ouvert} controles={controles} />

          {/* Ce qui est mesuré, et ce qui ne l'est pas. */}
          <div className="pointer-events-none absolute left-4 top-4 max-w-[260px] rounded-lg border border-white/10 bg-slate-900/85 px-3 py-2.5 backdrop-blur-md">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Mesures confirmées
            </p>
            <ul className="flex flex-col gap-0.5 text-[11px] text-slate-200">
              <li>Rack en L : {PENNE.rackEnL.portionCourte.valeur} m + {PENNE.rackEnL.retourLongitudinal.valeur} m</li>
              <li>Rack parallèle : {PENNE.rackParallele.longueur.valeur} m, reculé de {PENNE.rackParallele.reculDepart.valeur} m</li>
              <li>Allée : {PENNE.allee.valeur} m entre faces</li>
              <li>Racks : {PENNE.racks.hauteur.valeur} m · sol + 1 étage</li>
              <li>Mobilier Malin : {PENNE.mobilierMalin.largeur.valeur} × {PENNE.mobilierMalin.longueur.valeur} m</li>
              <li>Bureaux : Trust {PENNE.bureaux.trust.valeur} m² · MM {PENNE.bureaux.mobilierMalin.valeur} m²</li>
            </ul>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 max-w-[300px] rounded-lg border border-amber-400/20 bg-slate-900/85 px-3 py-2 backdrop-blur-md">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">
              Encore à mesurer
            </p>
            <ul className="flex flex-col gap-0.5 text-[11px] leading-snug text-slate-400">
              {INCERTITUDES.map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-900/90 px-4 py-2.5 backdrop-blur-md">
        <span className="mr-1 text-[12px] font-semibold text-white">
          Dépôt de La Penne · {PENNE.batiment.longueur.valeur} m
        </span>
        {(Object.keys(VUES_LOCALES) as VuePenne[]).map((v) => (
          <button
            key={v}
            onClick={() => allerA(v)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              vue === v
                ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
                : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
          >
            {VUES_LOCALES[v].nom}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button
          onClick={() => setOuvert((o) => !o)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            ouvert
              ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
              : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
          }`}
        >
          {ouvert ? "Masquer les racks" : "Afficher les racks"}
        </button>
        <span className="ml-auto text-[11px] text-slate-500">
          1 unité = 1 mètre · toiture masquée
        </span>
      </div>
    </div>
  );
}
