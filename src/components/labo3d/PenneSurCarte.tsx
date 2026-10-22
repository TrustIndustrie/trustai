"use client";

import { DepotPenne } from "./DepotPenne";
import { Cartouche, PlaqueAuSol } from "./Etiquette";
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
  survole,
  occupation,
  anomalies,
  nom,
  onSurvol,
  onClickBatiment,
  onClickToit,
}: {
  ouvert: boolean;
  selectionne: boolean;
  survole: boolean;
  occupation: number;
  anomalies: number;
  nom: string;
  onSurvol: (id: string | null) => void;
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
        onPointerOver={(e) => {
          e.stopPropagation();
          onSurvol("depot:aubagne");
        }}
        onPointerOut={() => onSurvol(null)}
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

      {/* LE NOM EST AU SOL, sur le terre-plein à gauche du bâtiment — pas sur
          la chaussée, où il se serait superposé au passage piéton et aux
          marquages du quai. Il suit le zoom et ne masque jamais rien. */}
      <PlaqueAuSol
        position={[-W / 2 - 8, 0.17, -L / 2 + 7]}
        lignes={[
          { texte: nom, taille: 42 },
          {
            texte: "implantation réelle · 1 quai",
            taille: 26,
            graisse: 400,
            couleur: "#f3c99a",
          },
        ]}
        fond="rgba(15, 23, 42, 0.8)"
        cadre="rgba(185, 98, 58, 0.55)"
      />

      {/* Le détail chiffré, seulement quand on désigne le dépôt. */}
      <Cartouche position={[0, H + 4, 0]} visible={selectionne || survole}>
        <div className="text-[13px] font-semibold leading-tight text-white">{nom}</div>
        <div className="text-[11px] leading-tight text-slate-300">
          {Math.round(occupation * 100)} % occupé
          {anomalies > 0 ? ` · ${anomalies} anomalie(s)` : ""}
        </div>
        <div className="text-[9px] leading-tight text-amber-300/70">
          bâtiment réel · rack en L · 1 quai à rideau
        </div>
      </Cartouche>
    </group>
  );
}
