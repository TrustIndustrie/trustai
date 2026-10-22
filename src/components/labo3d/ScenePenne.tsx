"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { OrbitControls as ControlesType } from "three-stdlib";
import { type RefObject } from "react";
import { DepotPenne } from "./DepotPenne";
import { PENNE } from "@/lib/labo3d/depot-penne";
import { VUE_INITIALE } from "@/lib/labo3d/vues-penne";

/**
 * LABORATOIRE 3D — la scène du dépôt de La Penne.
 *
 * Caméra en PERSPECTIVE, contrairement à la vue d'ensemble qui est
 * orthographique. Le choix n'est pas cosmétique : dans un bâtiment de cent
 * mètres, la perspective donne la profondeur qui fait comprendre la longueur
 * d'une allée. L'isométrique, elle, écrase cette longueur — excellent pour
 * lire un réseau, trompeur pour arpenter un volume.
 *
 * La toiture n'est jamais dessinée : on regarde un intérieur.
 */

export function ScenePenne({
  ouvert,
  controles,
}: {
  ouvert: boolean;
  controles: RefObject<ControlesType>;
}) {
  const L = PENNE.batiment.longueur.valeur;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: VUE_INITIALE.position, fov: 48, near: 0.5, far: 1200 }}
    >
      <hemisphereLight args={["#e6f0ff", "#a79f88", 1]} />
      <directionalLight
        position={[-40, 70, 40]}
        color="#fff4e2"
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-bias={-0.0008}
      />
      <directionalLight position={[60, 30, -30]} intensity={0.3} color="#cfdcee" />

      {/* Le terrain, assez large pour qu'aucun bord n'apparaisse au dézoom. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#a9b49c" roughness={1} />
      </mesh>

      <DepotPenne ouvert={ouvert} />

      <ContactShadows
        position={[0, 0.06, 0]}
        scale={L * 1.8}
        resolution={1536}
        blur={2.2}
        opacity={0.4}
        far={16}
        frames={1}
      />

      <OrbitControls
        ref={controles}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={8}
        maxDistance={240}
        target={VUE_INITIALE.cible}
      />
    </Canvas>
  );
}
