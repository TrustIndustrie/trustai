"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { COULEURS_ETAPE, COULEUR_ANOMALIE, zoneDeLEtape } from "@/lib/labo3d/etapes";
import type { Caisse, EtatScene } from "@/lib/labo3d/types";
import {
  avancementAffiche,
  placeDansZone,
  placeHorsSite,
  placeSurRemorque,
  positionSurRoute,
  trajetDuVehicule,
  voieDuVehicule,
} from "./geometrie";

/**
 * LABORATOIRE 3D — la marchandise.
 *
 * 200 caisses, UN SEUL objet d'affichage. C'est l'instanciation : le moteur
 * dessine la même géométrie deux cents fois en une passe, au lieu de deux
 * cents passes. Sans cela, la scène ramerait sur une carte graphique
 * intégrée ; avec, elle ne coûte presque rien.
 *
 * Chaque caisse glisse vers la position que son étape lui assigne. Changer
 * son statut la fait donc VOIR se déplacer : c'est la démonstration même de
 * « l'étape est la position ».
 */

const pivot = new Object3D();
const teinte = new Color();

/** Position que l'étape de la caisse lui assigne, à cet instant. */
function cible(
  caisse: Caisse,
  etat: EtatScene,
  temps: number,
  circulation: boolean,
): [number, number, number] {
  const zone = zoneDeLEtape(caisse.etape);

  if (caisse.vehiculeId) {
    const v = etat.vehicules.find((x) => x.id === caisse.vehiculeId);
    if (v) {
      // Exactement le même trajet que le camion : la caisse ne peut donc pas
      // flotter à côté de sa remorque.
      const base = positionSurRoute(
        trajetDuVehicule(v.role, avancementAffiche(v.progression, temps, circulation)),
      );
      const voie = voieDuVehicule(v.id, v.role);
      return placeSurRemorque([base[0] + voie, base[1], base[2]], caisse.rang);
    }
  }

  if (zone === "hors_site") return placeHorsSite(caisse.rang);
  if (zone === "route") return positionSurRoute(0.5);

  const depot =
    caisse.etape === "recue_argenteuil"
      ? "argenteuil"
      : caisse.etape === "recue_aubagne"
        ? "aubagne"
        : caisse.depot;

  return placeDansZone(depot, zone, caisse.rang);
}

interface Props {
  etat: EtatScene;
  /** Trafic continu : la caisse doit suivre son camion, pas le sol. */
  circulation: boolean;
  selection: string | null;
  survol: string | null;
  onSurvol: (id: string | null) => void;
  onClick: (id: string) => void;
}

export function Caisses({
  etat,
  circulation,
  selection,
  survol,
  onSurvol,
  onClick,
}: Props) {
  const corpsRef = useRef<InstancedMesh>(null);
  const couvercleRef = useRef<InstancedMesh>(null);
  const positions = useRef<Float32Array>(new Float32Array(0));
  const initialise = useRef(false);

  const caisses = etat.caisses;
  const nombre = caisses.length;

  // Une variation de taille déterministe, tirée de l'identifiant : des
  // caisses toutes identiques trahissent la simulation.
  const echelles = useMemo(
    () =>
      caisses.map((c) => {
        const n = Number(c.id.slice(2)) || 1;
        return 0.82 + ((n * 37) % 11) / 40 + c.quantite * 0.05;
      }),
    [caisses],
  );

  // Couleurs : recalculées quand une étape ou une anomalie change.
  useEffect(() => {
    const corps = corpsRef.current;
    if (!corps) return;
    caisses.forEach((c, i) => {
      teinte.set(c.anomalie ? COULEUR_ANOMALIE : COULEURS_ETAPE[c.etape]);
      if (c.id === selection) teinte.offsetHSL(0, 0.1, 0.18);
      corps.setColorAt(i, teinte);
    });
    if (corps.instanceColor) corps.instanceColor.needsUpdate = true;
  }, [caisses, selection]);

  useFrame((state, delta) => {
    const temps = state.clock.elapsedTime;
    const corps = corpsRef.current;
    const couvercle = couvercleRef.current;
    if (!corps || !couvercle) return;

    // Le dimensionnement se fait ICI et non dans un effet : la première
    // image peut précéder l'effet, et des écritures dans un tableau de
    // longueur nulle sont silencieusement ignorées — les caisses
    // s'empilaient alors toutes à l'origine.
    if (positions.current.length !== nombre * 3) {
      positions.current = new Float32Array(nombre * 3);
      initialise.current = false;
    }
    const pos = positions.current;
    const amorti = Math.min(1, delta * 3.2);

    for (let i = 0; i < nombre; i += 1) {
      const c = caisses[i];
      const [cx, cy, cz] = cible(c, etat, temps, circulation);

      if (!initialise.current) {
        pos[i * 3] = cx;
        pos[i * 3 + 1] = cy;
        pos[i * 3 + 2] = cz;
      } else {
        pos[i * 3] += (cx - pos[i * 3]) * amorti;
        pos[i * 3 + 1] += (cy - pos[i * 3 + 1]) * amorti;
        pos[i * 3 + 2] += (cz - pos[i * 3 + 2]) * amorti;
      }

      const mise = c.id === survol || c.id === selection ? 1.14 : 1;
      // Une caisse bloquée RESPIRE. Un rouge fixe se perd dans une scène
      // chargée ; un rouge qui bat attire l'œil exactement là où il faut, et
      // c'est tout l'intérêt d'une vue d'ensemble. Le battement est lent —
      // une alerte qui clignote vite devient un bruit qu'on finit par ignorer.
      const pouls = c.anomalie
        ? 1 + Math.sin(temps * 2.1 + (Number(c.id.slice(2)) || 0) * 0.6) * 0.07
        : 1;
      const e = echelles[i] * mise * pouls;

      pivot.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      pivot.rotation.set(0, ((Number(c.id.slice(2)) || 0) % 7) * 0.04, 0);
      pivot.scale.set(e, e * 0.8, e);
      pivot.updateMatrix();
      corps.setMatrixAt(i, pivot.matrix);

      // Le couvercle : une plaque fine posée sur la caisse. Deux passes de
      // dessin au total, et la marchandise cesse de ressembler à un cube nu.
      pivot.position.y = pos[i * 3 + 1] + e * 0.42;
      pivot.scale.set(e * 1.04, e * 0.1, e * 1.04);
      pivot.updateMatrix();
      couvercle.setMatrixAt(i, pivot.matrix);
    }

    initialise.current = true;
    corps.instanceMatrix.needsUpdate = true;
    couvercle.instanceMatrix.needsUpdate = true;
  });

  const auClic = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    const c = caisses[e.instanceId];
    if (c) onClick(c.id);
  };

  const auSurvol = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    const c = caisses[e.instanceId];
    onSurvol(c ? c.id : null);
  };

  if (nombre === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={corpsRef}
        args={[undefined, undefined, nombre]}
        castShadow
        receiveShadow
        onClick={auClic}
        onPointerMove={auSurvol}
        onPointerOut={() => onSurvol(null)}
      >
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshStandardMaterial roughness={0.82} metalness={0.02} />
      </instancedMesh>

      <instancedMesh ref={couvercleRef} args={[undefined, undefined, nombre]} castShadow>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshStandardMaterial color="#8a7f6d" roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
