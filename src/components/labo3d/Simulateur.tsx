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
  Database,
  FlaskConical,
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
  desactive,
}: {
  onClick: () => void;
  children: React.ReactNode;
  actif?: boolean;
  titre?: string;
  desactive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={titre}
      disabled={desactive}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
  source,
  onSource,
  chargement,
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
  onRecharger,
}: {
  source: "fictive" | "reelle";
  onSource: (s: "fictive" | "reelle") => void;
  chargement: boolean;
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
  onRecharger: () => void;
}) {
  // En données réelles, la simulation N'A PAS DE SENS : avancer d'un jour ou
  // déclencher une anomalie laisserait croire que TRUST AI agit sur la
  // marchandise. Les commandes de simulation sont donc éteintes ; il ne reste
  // que la caméra, les toits et la sélection — tout le reste serait un
  // mensonge à l'écran.
  const reel = source === "reelle";

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-900/90 px-4 py-2.5 backdrop-blur-md">
      <div className="mr-1 flex items-center gap-1 rounded-md border border-white/15 bg-white/5 p-0.5">
        <button
          onClick={() => onSource("fictive")}
          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] font-medium transition-colors ${
            reel ? "text-slate-300 hover:bg-white/10" : "bg-amber-400/20 text-amber-100"
          }`}
        >
          <FlaskConical size={13} aria-hidden /> Fictif
        </button>
        <button
          onClick={() => onSource("reelle")}
          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] font-medium transition-colors ${
            reel ? "bg-sky-400/20 text-sky-100" : "text-slate-300 hover:bg-white/10"
          }`}
        >
          <Database size={13} aria-hidden /> Réel (lecture seule)
        </button>
      </div>

      <span className="mx-1 h-5 w-px bg-white/10" />

      <span className="mr-1 text-[12px] font-semibold text-white">
        {reel ? (chargement ? "Lecture…" : "Instant réel") : `Jour ${jour}`}
      </span>

      <Bouton onClick={onJourSuivant} desactive={reel} titre="Avance d'un jour simulé">
        <ChevronsRight size={14} aria-hidden /> Jour suivant
      </Bouton>

      <Bouton
        onClick={onLecture}
        actif={lecture}
        desactive={reel}
        titre="Déroule les jours automatiquement"
      >
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
          disabled={reel}
          className="h-1 w-20 accent-emerald-400 disabled:opacity-40"
        />
      </label>

      <span className="mx-1 h-5 w-px bg-white/10" />

      <Bouton
        onClick={onTransfert}
        desactive={reel}
        titre={reel ? "Indisponible en données réelles" : "Charge un camion pour Aubagne"}
      >
        <Truck size={14} aria-hidden /> Lancer un transfert
      </Bouton>
      <Bouton
        onClick={onAnomalie}
        desactive={reel}
        titre={reel ? "Indisponible en données réelles" : "Bloque une caisse au hasard"}
      >
        <AlertTriangle size={14} aria-hidden /> Déclencher une anomalie
      </Bouton>
      <Bouton
        onClick={onLivrer}
        desactive={reel}
        titre={reel ? "Indisponible en données réelles" : "Solde les passages d'une tournée"}
      >
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

      {/* Un simple `ml-auto` se chevauchait avec le bouton précédent dès que
          le bandeau passait à la ligne : il faut un entretoise qui s'étire. */}
      <span className="grow" />
      <Bouton
        onClick={reel ? onRecharger : onReinitialiser}
        titre={reel ? "Relit les lignes logistiques" : "Remet la simulation à zéro"}
      >
        <RotateCcw size={14} aria-hidden /> {reel ? "Relire" : "Réinitialiser"}
      </Bouton>
    </div>
  );
}
