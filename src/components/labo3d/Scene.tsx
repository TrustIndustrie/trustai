"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { OrbitControls as ControlesType } from "three-stdlib";
import { type RefObject } from "react";
import { Depot } from "./Depot";
import { Caisses } from "./Caisses";
import { Vehicule } from "./Vehicule";
import {
  Balisage, Chariot, Eclairage, Magasin, Ouvrier, Sol, Vegetation,
} from "./Decor";
import { PLAN, PLAN_MAGASINS, PALETTES } from "./geometrie";
import type { CodeDepot, EtatScene, Selection } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — la scène et son éclairage.
 *
 * Caméra ORTHOGRAPHIQUE : c'est la vraie isométrie. Une caméra en
 * perspective donnerait des fuyantes et des bâtiments penchés ; en
 * orthographique, deux objets de même taille restent de même taille où
 * qu'ils soient, ce qui est exactement ce qu'on attend d'un plan.
 *
 * L'éclairage tient en trois sources, et c'est lui qui fait la qualité :
 *   * une lumière directionnelle, le soleil, qui porte les ombres ;
 *   * une lumière hémisphérique, le ciel, qui remplit les faces sombres
 *     sans les éteindre ;
 *   * une lumière d'appoint à l'opposé, faible, pour détacher les volumes.
 *
 * Les ombres portées sont limitées à une carte de 2048 pixels sur une zone
 * serrée : au-delà, le coût grimpe vite pour un gain invisible.
 */

interface Props {
  etat: EtatScene;
  selection: Selection;
  survol: string | null;
  ouverts: Record<CodeDepot, boolean>;
  /** Mode présentation : la caméra tourne seule, pour commenter sans piloter. */
  presentation: boolean;
  controles: RefObject<ControlesType>;
  onSelection: (s: Selection) => void;
  onSurvol: (id: string | null) => void;
  onBasculerToit: (code: CodeDepot) => void;
}

export function Scene({
  etat,
  selection,
  survol,
  ouverts,
  presentation,
  controles,
  onSelection,
  onSurvol,
  onBasculerToit,
}: Props) {
  const idSelectionne =
    selection && selection.genre === "caisse" ? selection.id : null;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      orthographic
      camera={{ position: [60, 52, 60], zoom: 9, near: -200, far: 400 }}
      onPointerMissed={() => onSelection(null)}
    >
      {/* Trois lumières, et chacune a un rôle : le ciel et le sol donnent
          l'ambiance, la clé chaude sculpte les volumes et porte l'ombre, le
          remplissage froid empêche que les faces à l'ombre deviennent des
          trous noirs. Une quatrième passe d'ombre coûterait plus cher que
          tout ce qu'elle apporterait. */}
      <hemisphereLight args={["#e6f0ff", "#a79f88", 0.95]} />
      <directionalLight
        position={[38, 52, 26]}
        color="#fff4e2"
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-near={1}
        shadow-camera-far={180}
        shadow-bias={-0.0008}
      />
      <directionalLight position={[-30, 24, -34]} intensity={0.34} color="#cfdcee" />
      {/* Contre-jour rasant : il détache les toits du ciel. */}
      <directionalLight position={[-18, 8, 44]} intensity={0.22} color="#ffe9cc" />

      <Sol />
      <Vegetation />
      <Eclairage />
      <Balisage />

      {etat.depots.map((d) => {
        const presentes = etat.caisses.filter(
          (c) => c.depot === d.code && (c.etape === "disponible" || c.etape.startsWith("recue")),
        ).length;
        return (
          <Depot
            key={d.code}
            modele={d}
            ouvert={ouverts[d.code]}
            selectionne={selection?.genre === "depot" && selection.code === d.code}
            occupation={Math.min(1, presentes / d.capacite)}
            anomalies={
              etat.caisses.filter((c) => c.depot === d.code && c.anomalie).length
            }
            onClickBatiment={() => onSelection({ genre: "depot", code: d.code })}
            onClickToit={() => onBasculerToit(d.code)}
          />
        );
      })}

      {/* Les magasins du Nord portent le bleu d'Argenteuil, celui du Sud
          l'ocre de La Penne : on lit le rattachement sans rien cliquer. */}
      {PLAN_MAGASINS.map((m) => (
        <Magasin
          key={m.nom}
          nom={m.nom}
          position={m.position}
          couleur={m.position[2] > 0 ? PALETTES.aubagne.bandeau : PALETTES.argenteuil.bandeau}
          onClick={(nom) => onSelection({ genre: "magasin", nom })}
        />
      ))}

      <Caisses
        etat={etat}
        selection={idSelectionne}
        survol={survol}
        onSurvol={onSurvol}
        onClick={(id) => onSelection({ genre: "caisse", id })}
      />

      {etat.vehicules.map((v) => (
        <Vehicule
          key={v.id}
          modele={v}
          selectionne={selection?.genre === "vehicule" && selection.id === v.id}
          survole={survol === v.id}
          onSurvol={onSurvol}
          onClick={(id) => onSelection({ genre: "vehicule", id })}
        />
      ))}

      {/* Décor animé : seulement quand le toit est levé, sinon on anime des
          objets que personne ne voit. */}
      {ouverts.argenteuil && (
        <>
          <Chariot depot="argenteuil" decalage={0} />
          <Chariot depot="argenteuil" decalage={2.2} />
          <Ouvrier base={[PLAN.argenteuil.centre[0] - 8, 0, PLAN.argenteuil.centre[2]]} rayon={2.2} decalage={0.5} />
          <Ouvrier base={[PLAN.argenteuil.centre[0] + 9, 0, PLAN.argenteuil.centre[2] + 2]} rayon={1.8} decalage={3.1} />
        </>
      )}
      {ouverts.aubagne && (
        <>
          <Chariot depot="aubagne" decalage={1.1} />
          <Ouvrier base={[PLAN.aubagne.centre[0] - 6, 0, PLAN.aubagne.centre[2]]} rayon={1.9} decalage={1.7} />
        </>
      )}

      {/* Ombres de contact : dix fois moins coûteuses qu'une carte d'ombres
          supplémentaire, et c'est ce qui « pose » les objets au sol. */}
      <ContactShadows
        position={[0, 0.04, 0]}
        scale={120}
        resolution={1024}
        blur={2.4}
        opacity={0.42}
        far={14}
        frames={1}
      />

      <OrbitControls
        ref={controles}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        // Mode présentation : une rotation lente, assez pour donner du
        // relief, assez peu pour ne pas donner le tournis à l'assistance.
        autoRotate={presentation}
        autoRotateSpeed={0.45}
        // On empêche de passer sous le sol et de regarder à la verticale :
        // la vue reste toujours lisible.
        minPolarAngle={Math.PI / 7}
        maxPolarAngle={Math.PI / 2.45}
        minZoom={6}
        maxZoom={48}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
