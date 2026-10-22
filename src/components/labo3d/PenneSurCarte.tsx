"use client";

import { useEffect, useMemo, useRef } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { DepotPenne } from "./DepotPenne";
import { Cartouche, PlaqueAuSol } from "./Etiquette";
import { CHARGE_ALVEOLE, PLAN, alveolesPenne } from "./geometrie";
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
const ECHELLE = PLAN.aubagne.profondeur / PENNE.batiment.longueur.valeur;

/**
 * LE GARNISSAGE DES RACKS — ce qui remplit les alvéoles que la marchandise
 * réelle n'occupe pas.
 *
 * « Les racks sont toujours pleins » : c'est une mesure confirmée, pas une
 * licence décorative. Mais les caisses de la base n'en remplissent qu'une
 * partie, et doubler les deux représentations aurait donné des racks deux
 * fois chargés. On garnit donc EXACTEMENT le complément : les alvéoles de
 * rang supérieur au nombre de caisses stockées, dans le même ordre que celui
 * où `placeDansRacksPenne` les distribue.
 *
 * Ces charges-là ne portent aucune donnée. Elles sont ternes, volontairement :
 * les caisses réelles, elles, ont la couleur de leur étape.
 */
function GarnissageRacks({ depuis }: { depuis: number }) {
  const maille = useRef<InstancedMesh>(null);
  const places = useMemo(() => alveolesPenne().slice(depuis), [depuis]);

  useEffect(() => {
    const m = maille.current;
    if (!m) return;
    const pivot = new Object3D();
    const teinte = new Color();
    places.forEach((p, i) => {
      pivot.position.set(p[0], p[1], p[2]);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, 0.82 + ((i * 7) % 5) / 10, 1);
      pivot.updateMatrix();
      m.setMatrixAt(i, pivot.matrix);
      teinte.set(i % 3 === 0 ? "#7f6a56" : i % 3 === 1 ? "#8d7a63" : "#6f5f4e");
      m.setColorAt(i, teinte);
    });
    m.count = places.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [places]);

  if (places.length === 0) return null;

  return (
    <instancedMesh
      ref={maille}
      args={[undefined, undefined, places.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={CHARGE_ALVEOLE} />
      <meshStandardMaterial roughness={0.88} />
    </instancedMesh>
  );
}

export function PenneSurCarte({
  ouvert,
  selectionne,
  survole,
  occupation,
  anomalies,
  stockees,
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
  /** Nombre de caisses réelles logées dans les racks : le garnissage prend
   *  la suite, sans se superposer à elles. */
  stockees: number;
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
    <>
      {/* LE GARNISSAGE VIT HORS DU GROUPE DU BÂTIMENT. Les alvéoles sont déjà
          calculées en coordonnées de plateau par `alveolesPenne` : posées dans
          le groupe, elles auraient reçu le centre du dépôt une seconde fois et
          la marchandise se serait retrouvée dans le champ d'à côté — ce qui
          est exactement ce qui s'est passé au premier essai. */}
      {ouvert && <GarnissageRacks depuis={stockees} />}

      <group position={p.centre}>
        {/* La rotation aligne l'axe entrée → fond sur l'axe de la carte :
          l'entrée et son quai unique font face à la route qui vient
          d'Argenteuil, au nord. */}
        <group rotation={[0, -Math.PI / 2, 0]} scale={ECHELLE}>
          {/* LES RACKS NE PORTENT PAS DE CHARGE DÉCORATIVE ICI : ce sont les
            VRAIES caisses — avec leur étape et leur couleur — qui occupent
            les alvéoles, posées par `placeDansRacksPenne`. Deux marchandises
            superposées auraient fait un rack deux fois plein. */}
          <DepotPenne ouvert={ouvert} etiquettes={false} marchandise={false} />
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
          <div className="text-[13px] font-semibold leading-tight text-white">
            {nom}
          </div>
          <div className="text-[11px] leading-tight text-slate-300">
            {Math.round(occupation * 100)} % occupé
            {anomalies > 0 ? ` · ${anomalies} anomalie(s)` : ""}
          </div>
          <div className="text-[9px] leading-tight text-amber-300/70">
            bâtiment réel · rack en L · 1 quai à rideau
          </div>
        </Cartouche>
      </group>
    </>
  );
}
