"use client";

import { Html } from "@react-three/drei";
import { DepotPenne } from "./DepotPenne";
import { PLAN } from "./geometrie";
import { PENNE } from "@/lib/labo3d/depot-penne";

/**
 * LE VRAI DÉPÔT DE LA PENNE, POSÉ SUR LA CARTE D'ENSEMBLE.
 *
 * Ce n'est pas une seconde maquette : c'est EXACTEMENT la géométrie décrite
 * par Farouk — le rack en L, le rack parallèle, l'allée de 5 m, le bloc
 * bureaux, le rideau métallique — réduite à la taille d'un symbole de carte.
 * Le modèle vit en mètres dans `DepotPenne` ; ici on ne fait que le poser.
 *
 * POURQUOI UNE RÉDUCTION PLUTÔT QUE L'ÉCHELLE RÉELLE.
 * La vue d'ensemble n'est pas à l'échelle et ne peut pas l'être : sa route
 * fait 86 unités pour 770 km. Le bâtiment y occupe donc la place que la carte
 * lui donne, mais avec ses VRAIES PROPORTIONS — 100 sur 45, soit un rapport
 * de 2,2 — là où le dessin précédent en faisait un carré.
 *
 * Il n'y a donc plus deux dépôts différents selon l'écran. Un seul modèle,
 * deux grossissements.
 */

/** 100 m réels pour 40 unités de carte. */
const ECHELLE =
  PLAN.aubagne.profondeur / PENNE.batiment.longueur.valeur;

export function PenneSurCarte({
  ouvert,
  selectionne,
  occupation,
  anomalies,
  nom,
  onClickBatiment,
  onClickToit,
}: {
  ouvert: boolean;
  selectionne: boolean;
  occupation: number;
  anomalies: number;
  nom: string;
  onClickBatiment: () => void;
  onClickToit: () => void;
}) {
  const p = PLAN.aubagne;
  const L = PENNE.batiment.longueur.valeur * ECHELLE;
  const W = PENNE.batiment.largeur.valeur * ECHELLE;
  const H = PENNE.batiment.hauteur.valeur * ECHELLE;

  return (
    <group position={p.centre}>
      {/* La rotation aligne l'axe entrée → fond sur l'axe de la carte :
          l'entrée et son quai unique font face à la route qui vient
          d'Argenteuil, au nord. */}
      <group rotation={[0, -Math.PI / 2, 0]} scale={ECHELLE}>
        <DepotPenne ouvert={ouvert} etiquettes={false} />
      </group>

      {/* Le volume de clic. Les cloisons et les racks sont trop fins pour
          qu'on les vise à la souris à cette taille : une boîte invisible
          couvre le bâtiment et porte la sélection. Elle ne se voit pas, mais
          c'est elle qui rend le dépôt cliquable comme les autres. */}
      <mesh
        position={[0, H / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClickBatiment();
        }}
      >
        <boxGeometry args={[W, H, L]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Le même geste que sur les autres bâtiments : cliquer « le toit »
          montre ou masque la marchandise. Ici il n'y a pas de toit à lever —
          il n'est jamais dessiné — alors c'est une plaque posée au-dessus. */}
      <mesh
        position={[0, H + 0.6, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClickToit();
        }}
      >
        <boxGeometry args={[W + 0.6, 0.5, L + 0.6]} />
        <meshStandardMaterial
          color={selectionne ? "#ffffff" : "#6d5347"}
          roughness={0.85}
          transparent
          opacity={ouvert ? 0.16 : 0.92}
        />
      </mesh>

      <Html position={[0, H + 5, 0]} center zIndexRange={[20, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded-md border border-white/20 bg-slate-900/85 px-3 py-1.5 text-center shadow-lg backdrop-blur-sm">
          <div className="text-[13px] font-semibold leading-tight text-white">{nom}</div>
          <div className="text-[11px] leading-tight text-slate-300">
            {Math.round(occupation * 100)} % occupé
            {anomalies > 0 ? ` · ${anomalies} anomalie(s)` : ""}
          </div>
          <div className="text-[9px] leading-tight text-amber-300/70">
            implantation réelle · 1 quai
          </div>
        </div>
      </Html>
    </group>
  );
}
