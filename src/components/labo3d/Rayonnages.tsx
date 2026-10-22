"use client";

import { useEffect, useMemo, useRef } from "react";
import { Object3D, type InstancedMesh } from "three";
import { PLAN, rectangleZone } from "./geometrie";
import type { CodeDepot } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — les travées de rayonnage. DÉCORATIF.
 *
 * Un sol nu sous des caisses posées en grille ne ressemble à rien : les
 * caisses flottent dans un hangar vide. Des travées — échelles verticales,
 * lisses horizontales, allées entre les rangées — et l'intérieur devient
 * immédiatement un entrepôt.
 *
 * ⚠ AUCUNE INFORMATION MÉTIER. Les rayonnages ne sont pas cliquables et ne
 * disent rien de ce qu'ils portent : seules les caisses portent la donnée.
 * Ils sont placés selon la zone de stockage, pas selon le stock réel.
 *
 * TOUT EST INSTANCIÉ : deux appels de dessin pour l'ensemble des montants et
 * deux pour les lisses, quel que soit le nombre de travées. Un rayonnage
 * dessiné pièce par pièce aurait coûté plus cher que les deux cents caisses
 * réunies.
 */

const pivot = new Object3D();

/** Hauteur d'un niveau de lisse, alignée sur l'empilement des caisses. */
const PAS_NIVEAU = 0.95;

export function Rayonnages({ depot, visible }: { depot: CodeDepot; visible: boolean }) {
  const montants = useRef<InstancedMesh>(null);
  const lisses = useRef<InstancedMesh>(null);
  const p = PLAN[depot];

  // La géométrie des travées, calculée une fois : elle ne dépend que du plan.
  const plan = useMemo(() => {
    const r = rectangleZone(depot, "stockage");
    const pas = 1.6;
    const rangees = Math.max(2, Math.floor(r.profondeur / pas));
    const colonnes = Math.max(2, Math.floor(r.largeur / pas));
    const niveauxMax = Math.max(1, Math.floor((p.hauteur - 2.2) / PAS_NIVEAU));

    const posMontants: [number, number, number][] = [];
    const posLisses: { position: [number, number, number]; longueur: number }[] = [];

    for (let rangee = 0; rangee < rangees; rangee += 1) {
      const z = p.centre[2] + r.z - (r.profondeur - pas) / 2 + rangee * pas;
      // Une échelle tous les quatre emplacements : assez pour lire « travée »,
      // assez peu pour ne pas transformer l'intérieur en forêt de poteaux.
      for (let colonne = 0; colonne <= colonnes; colonne += 4) {
        const x = p.centre[0] + r.x - (r.largeur - pas) / 2 + colonne * pas;
        posMontants.push([x, (niveauxMax * PAS_NIVEAU) / 2 + 0.3, z]);
      }
      // Les lisses : une par niveau, sur toute la longueur de la travée.
      for (let niveau = 1; niveau <= niveauxMax; niveau += 1) {
        posLisses.push({
          position: [p.centre[0] + r.x, niveau * PAS_NIVEAU - 0.1, z],
          longueur: r.largeur,
        });
      }
    }
    return { posMontants, posLisses, hauteur: niveauxMax * PAS_NIVEAU + 0.6 };
  }, [depot, p.centre, p.hauteur]);

  useEffect(() => {
    const m = montants.current;
    const l = lisses.current;
    if (!m || !l) return;

    plan.posMontants.forEach((pos, i) => {
      pivot.position.set(pos[0], pos[1], pos[2]);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, plan.hauteur, 1);
      pivot.updateMatrix();
      m.setMatrixAt(i, pivot.matrix);
    });
    plan.posLisses.forEach((lisse, i) => {
      pivot.position.set(lisse.position[0], lisse.position[1], lisse.position[2]);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(lisse.longueur, 1, 1);
      pivot.updateMatrix();
      l.setMatrixAt(i, pivot.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
  }, [plan]);

  // Monté seulement quand le toit est levé : invisible sous un toit fermé,
  // c'est de la géométrie dessinée pour personne.
  if (!visible || plan.posMontants.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={montants}
        args={[undefined, undefined, plan.posMontants.length]}
        castShadow
      >
        {/* Unité en hauteur : la matrice d'instance l'étire au besoin. */}
        <boxGeometry args={[0.12, 1, 0.12]} />
        <meshStandardMaterial color="#3f6ea8" roughness={0.6} metalness={0.3} />
      </instancedMesh>

      <instancedMesh ref={lisses} args={[undefined, undefined, plan.posLisses.length]}>
        <boxGeometry args={[1, 0.09, 0.1]} />
        <meshStandardMaterial color="#d98324" roughness={0.65} metalness={0.2} />
      </instancedMesh>
    </group>
  );
}
