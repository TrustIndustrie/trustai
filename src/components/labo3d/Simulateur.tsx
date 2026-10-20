"use client";

import {
  AlertTriangle,
  ChevronsRight,
  Pause,
  Play,
  RotateCcw,
  Truck,
  PackageCheck,
  Eye,
} from "lucide-react";
import type { CodeDepot } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — le bandeau de contrôle.
 *
 * C'est lui qui fait la différence entre une image et une démonstration :
 * on force un statut, et on regarde la scène réagir.
 */

function Bouton({
  onClick,
  children,
  actif,
  titre,
}: {
  onClick: () => void;
  children: React.ReactNode;
  actif?: boolean;
  titre?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={titre}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        actif
          ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
          : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export function Simulateur({
  jour,
  lecture,
  vitesse,
  ouverts,
  onJourSuivant,
  onLecture,
  onVitesse,
  onTransfert,
  onAnomalie,
  onLivrer,
  onReinitialiser,
  onBasculerToit,
  onVueGenerale,
}: {
  jour: number;
  lecture: boolean;
  vitesse: number;
  ouverts: Record<CodeDepot, boolean>;
  onJourSuivant: () => void;
  onLecture: () => void;
  onVitesse: (v: number) => void;
  onTransfert: () => void;
  onAnomalie: () => void;
  onLivrer: () => void;
  onReinitialiser: () => void;
  onBasculerToit: (c: CodeDepot) => void;
  onVueGenerale: () => void;
}) {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-900/90 px-4 py-2.5 backdrop-blur-md">
      <span className="mr-1 text-[12px] font-semibold text-white">
        Jour {jour}
      </span>

      <Bouton onClick={onJourSuivant} titre="Avance d'un jour simulé">
        <ChevronsRight size={14} aria-hidden /> Jour suivant
      </Bouton>

      <Bouton onClick={onLecture} actif={lecture} titre="Déroule les jours automatiquement">
        {lecture ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        {lecture ? "Pause" : "Lecture auto"}
      </Bouton>

      <label className="ml-1 flex items-center gap-1.5 text-[11px] text-slate-400">
        vitesse
        <input
          type="range"
          min={0.4}
          max={3}
          step={0.2}
          value={vitesse}
          onChange={(e) => onVitesse(Number(e.target.value))}
          className="h-1 w-20 accent-emerald-400"
        />
      </label>

      <span className="mx-1 h-5 w-px bg-white/10" />

      <Bouton onClick={onTransfert} titre="Charge un camion pour Aubagne">
        <Truck size={14} aria-hidden /> Lancer un transfert
      </Bouton>
      <Bouton onClick={onAnomalie} titre="Bloque une caisse au hasard">
        <AlertTriangle size={14} aria-hidden /> Déclencher une anomalie
      </Bouton>
      <Bouton onClick={onLivrer} titre="Solde les passages d'une tournée">
        <PackageCheck size={14} aria-hidden /> Livrer une tournée
      </Bouton>

      <span className="mx-1 h-5 w-px bg-white/10" />

      <Bouton onClick={() => onBasculerToit("argenteuil")} actif={ouverts.argenteuil}>
        <Eye size={14} aria-hidden /> Toit Argenteuil
      </Bouton>
      <Bouton onClick={() => onBasculerToit("aubagne")} actif={ouverts.aubagne}>
        <Eye size={14} aria-hidden /> Toit Aubagne
      </Bouton>
      <Bouton onClick={onVueGenerale} titre="Recentre la caméra">
        Vue générale
      </Bouton>

      <span className="ml-auto" />
      <Bouton onClick={onReinitialiser} titre="Remet la simulation à zéro">
        <RotateCcw size={14} aria-hidden /> Réinitialiser
      </Bouton>
    </div>
  );
}
