"use client";

import { useEffect, useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { Object3D, type InstancedMesh } from "three";
import { PENNE, abscissesRacks } from "@/lib/labo3d/depot-penne";

/**
 * LE DÉPÔT DE LA PENNE-SUR-HUVEAUNE — reconstitution à l'échelle réelle.
 *
 * Une unité de scène = UN MÈTRE. Le bâtiment fait donc cent mètres de long,
 * et c'est pour cette raison qu'il vit dans sa propre vue : à cette échelle,
 * il écraserait la carte d'ensemble où Argenteuil tient en trente unités.
 *
 * ⚠ CE N'EST PAS UN RELEVÉ DE GÉOMÈTRE. Toutes les mesures viennent de
 * `lib/labo3d/depot-penne.ts`, où chacune porte son statut — confirmée ou
 * hypothèse. Rien n'est inventé ici : ce composant dessine ce que la
 * configuration déclare, et rien de plus.
 *
 * Le mobilier et les silhouettes sont du DÉCOR assumé. Ils ne représentent ni
 * un stock réel, ni une présence réelle.
 */

const pivot = new Object3D();

const MUR = "#efe8dc";
const DALLE = "#c9c4ba";
const MONTANT = "#3f6ea8";
const LISSE = "#d98324";

export function DepotPenne({ ouvert = true }: { ouvert?: boolean }) {
  const L = PENNE.batiment.longueur.valeur;
  const W = PENNE.batiment.largeur.valeur;
  const H = PENNE.batiment.hauteur.valeur;
  const ax = abscissesRacks();

  return (
    <group position={[-L / 2, 0, -W / 2]}>
      {/* La dalle. */}
      <mesh position={[L / 2, 0.05, W / 2]} receiveShadow>
        <boxGeometry args={[L + 2, 0.1, W + 2]} />
        <meshStandardMaterial color={DALLE} roughness={0.95} />
      </mesh>

      {/* Les murs. Le mur de DROITE (z = W, côté bureaux) et le mur du FOND
          sont conservés ; ceux de gauche et d'entrée sont retirés, pour qu'on
          voie l'intérieur depuis l'entrée sans vitre ni transparence. */}
      <mesh position={[L / 2, H / 2, W + 0.2]} castShadow receiveShadow>
        <boxGeometry args={[L, H, 0.4]} />
        <meshStandardMaterial color={MUR} roughness={0.8} />
      </mesh>
      <mesh position={[L + 0.2, H / 2, W / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.4, H, W]} />
        <meshStandardMaterial color={MUR} roughness={0.8} />
      </mesh>
      {/* Le mur de gauche est bas : il porte les racks, on doit les voir. */}
      <mesh position={[L / 2, 1.2, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[L, 2.4, 0.4]} />
        <meshStandardMaterial color={MUR} roughness={0.8} />
      </mesh>

      {/* Le mur d'entrée, percé de sa porte. Deux tronçons de part et d'autre
          plutôt qu'un trou : un mur troué demanderait une géométrie taillée,
          là où deux pans disent la même chose. */}
      {(() => {
        const d = PENNE.entree.decalageDepuisRacks.valeur;
        const l = PENNE.entree.largeur.valeur;
        const avant = Math.max(0, d - l / 2);
        const apres = Math.max(0, W - (d + l / 2));
        return (
          <group>
            <mesh position={[-0.2, 1.2, avant / 2]} castShadow>
              <boxGeometry args={[0.4, 2.4, avant]} />
              <meshStandardMaterial color={MUR} roughness={0.8} />
            </mesh>
            <mesh position={[-0.2, 1.2, W - apres / 2]} castShadow>
              <boxGeometry args={[0.4, 2.4, apres]} />
              <meshStandardMaterial color={MUR} roughness={0.8} />
            </mesh>
            {/* Le marquage de la porte, au sol. */}
            <mesh position={[0.8, 0.12, d]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[3, l]} />
              <meshStandardMaterial color="#e8dfc8" roughness={1} />
            </mesh>
            <Html position={[-2.5, 2.4, d]} center zIndexRange={[16, 0]}>
              <div className="pointer-events-none select-none whitespace-nowrap rounded border border-white/20 bg-slate-900/85 px-2 py-0.5 text-[11px] font-medium text-white shadow">
                Entrée
              </div>
            </Html>
          </group>
        );
      })()}

      {/* LE RACK EN L : le retour longitudinal le long du mur de gauche, et la
          portion courte le long du mur d'entrée. */}
      <Rack
        depart={[0, 0]}
        longueur={PENNE.rackEnL.retourLongitudinal.valeur}
        profondeur={PENNE.rackEnL.profondeur.valeur}
        sens="longueur"
        visible={ouvert}
      />
      <Rack
        depart={[0, 0]}
        longueur={PENNE.rackEnL.portionCourte.valeur}
        profondeur={PENNE.rackEnL.profondeur.valeur}
        sens="largeur"
        visible={ouvert}
      />

      {/* LE RACK PARALLÈLE : même extrémité au fond, départ reculé de 20 m. */}
      <Rack
        depart={[PENNE.rackParallele.reculDepart.valeur, ax.paralleleDebut]}
        longueur={PENNE.rackParallele.longueur.valeur}
        profondeur={PENNE.rackParallele.profondeur.valeur}
        sens="longueur"
        visible={ouvert}
      />

      {/* L'allée de travail, marquée au sol : c'est elle qui donne l'échelle
          du bâtiment quand on regarde depuis l'entrée. */}
      <mesh
        position={[L / 2, 0.12, (ax.grandFin + ax.paralleleDebut) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[L, PENNE.allee.valeur]} />
        <meshStandardMaterial color="#bdb6a6" roughness={1} />
      </mesh>

      {/* LA ZONE MOBILIER MALIN — 30 m de large sur 100 m, à droite et devant
          soi. Son contour est approximatif, et l'étiquette le dit. */}
      <mesh
        position={[L / 2, 0.11, W - PENNE.mobilierMalin.largeur.valeur / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[L - 2, PENNE.mobilierMalin.largeur.valeur - 1]} />
        <meshStandardMaterial color="#cfddc8" roughness={1} transparent opacity={0.75} />
      </mesh>
      <Html
        position={[L * 0.62, 1.4, W - PENNE.mobilierMalin.largeur.valeur / 2]}
        center
        zIndexRange={[14, 0]}
      >
        <div className="pointer-events-none select-none whitespace-nowrap rounded border border-emerald-300/25 bg-slate-900/80 px-2.5 py-1 text-center shadow">
          <div className="text-[12px] font-semibold text-emerald-100">Mobilier Malin</div>
          <div className="text-[10px] text-emerald-200/70">
            mobilier de bureau d&apos;occasion · ~30 × 100 m
          </div>
        </div>
      </Html>

      <BlocBureaux largeurBatiment={W} />
    </group>
  );
}

/**
 * Un rack à DEUX niveaux : le sol et un étage. Pas deux étages au-dessus du
 * sol — c'est l'erreur de lecture que la description prenait soin d'écarter,
 * et elle doublerait la hauteur apparente du stockage.
 *
 * Montants et lisses sont instanciés : deux appels de dessin par rack, quelle
 * que soit sa longueur. Un rack de cent mètres dessiné travée par travée
 * aurait coûté plus cher que toute la scène d'ensemble.
 */
function Rack({
  depart,
  longueur,
  profondeur,
  sens,
  visible,
}: {
  depart: [number, number];
  longueur: number;
  profondeur: number;
  sens: "longueur" | "largeur";
  visible: boolean;
}) {
  const montants = useRef<InstancedMesh>(null);
  const lisses = useRef<InstancedMesh>(null);

  const plan = useMemo(() => {
    const h = PENNE.racks.hauteur.valeur;
    const travee = PENNE.racks.travee.valeur;
    const n = Math.max(2, Math.round(longueur / travee));
    const posMontants: [number, number, number][] = [];
    const posLisses: [number, number, number][] = [];

    for (let i = 0; i <= n; i += 1) {
      const t = (i * longueur) / n;
      // Deux montants par cadre : l'avant et l'arrière du rack.
      for (const p of [0.15, profondeur - 0.15]) {
        const [x, z] =
          sens === "longueur" ? [depart[0] + t, depart[1] + p] : [depart[0] + p, depart[1] + t];
        posMontants.push([x, h / 2, z]);
      }
    }
    // Une lisse par niveau et par travée. Deux niveaux : le sol n'a pas de
    // lisse, l'étage en a une, et le sommet en a une qui ferme le cadre.
    for (const y of [PENNE.racks.hauteurPremierNiveau.valeur, h - 0.25]) {
      for (let i = 0; i < n; i += 1) {
        const t = ((i + 0.5) * longueur) / n;
        const [x, z] =
          sens === "longueur"
            ? [depart[0] + t, depart[1] + profondeur / 2]
            : [depart[0] + profondeur / 2, depart[1] + t];
        posLisses.push([x, y, z]);
      }
    }
    return { posMontants, posLisses, h, pas: longueur / n };
  }, [depart, longueur, profondeur, sens]);

  useEffect(() => {
    const m = montants.current;
    const l = lisses.current;
    if (!m || !l) return;
    plan.posMontants.forEach((pos, i) => {
      pivot.position.set(pos[0], pos[1], pos[2]);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, plan.h, 1);
      pivot.updateMatrix();
      m.setMatrixAt(i, pivot.matrix);
    });
    plan.posLisses.forEach((pos, i) => {
      pivot.position.set(pos[0], pos[1], pos[2]);
      pivot.rotation.set(0, sens === "longueur" ? 0 : Math.PI / 2, 0);
      pivot.scale.set(plan.pas, 1, 1);
      pivot.updateMatrix();
      l.setMatrixAt(i, pivot.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
  }, [plan, sens]);

  if (!visible) return null;

  return (
    <group>
      <instancedMesh ref={montants} args={[undefined, undefined, plan.posMontants.length]} castShadow>
        <boxGeometry args={[0.14, 1, 0.14]} />
        <meshStandardMaterial color={MONTANT} roughness={0.6} metalness={0.3} />
      </instancedMesh>
      <instancedMesh ref={lisses} args={[undefined, undefined, plan.posLisses.length]} castShadow>
        <boxGeometry args={[1, 0.12, 0.1]} />
        <meshStandardMaterial color={LISSE} roughness={0.65} metalness={0.2} />
      </instancedMesh>
    </group>
  );
}

/**
 * LE BLOC BUREAUX — à l'intérieur du dépôt, à droite quand on entre.
 *
 * C'est là que les livreurs viennent chercher leurs bons, et c'est la raison
 * pour laquelle il ne doit PAS être un cube opaque : on montre le couloir, les
 * deux portes qui se font face, et les surfaces annoncées.
 *
 * Ce que la description ne dit pas est laissé vide plutôt qu'inventé : le
 * cloisonnement des sanitaires n'est pas connu, ils forment donc un seul
 * volume étiqueté, sans portes imaginaires.
 */
function BlocBureaux({ largeurBatiment }: { largeurBatiment: number }) {
  const B = PENNE.bureaux;
  const x0 = B.reculDepuisEntree.valeur;
  const couloirL = B.couloir.longueur.valeur;
  const couloirW = B.couloir.largeur.valeur;

  // Les deux bureaux encadrent le couloir. Leurs surfaces sont connues, leurs
  // proportions non : on fixe la profondeur sur le couloir et on en déduit la
  // largeur, ce qui respecte la surface sans prétendre à la forme.
  const profondeurBureau = 3.2;
  const largeurTrust = B.trust.valeur / profondeurBureau;
  const largeurMM = B.mobilierMalin.valeur / profondeurBureau;

  // Le couloir court perpendiculairement au mur de droite, vers l'intérieur.
  const zMur = largeurBatiment - 0.4;
  const hauteur = 2.6;

  const cloison = (
    position: [number, number, number],
    taille: [number, number, number],
    cle: string,
  ) => (
    <mesh key={cle} position={position} castShadow receiveShadow>
      <boxGeometry args={taille} />
      <meshStandardMaterial color="#e3dcd0" roughness={0.85} />
    </mesh>
  );

  return (
    <group>
      {/* Dalle du bloc, pour qu'il se détache du sol du dépôt. */}
      <mesh
        position={[x0 + couloirL / 2, 0.13, zMur - 2.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[couloirL + largeurMM + 2, 7.5]} />
        <meshStandardMaterial color="#d7d2c6" roughness={1} />
      </mesh>

      {/* Le couloir : deux cloisons parallèles, porte battante côté dépôt. */}
      {cloison(
        [x0 + couloirL / 2, hauteur / 2, zMur - couloirW / 2 - 0.1],
        [couloirL, hauteur, 0.2],
        "couloir-gauche",
      )}
      {cloison(
        [x0 + couloirL / 2, hauteur / 2, zMur - couloirW / 2 - 0.1 - couloirW],
        [couloirL, hauteur, 0.2],
        "couloir-droite",
      )}

      {/* La porte battante, entrouverte : elle dit le sens d'usage. */}
      <mesh
        position={[x0 - 0.1, 1.05, zMur - couloirW]}
        rotation={[0, -0.5, 0]}
        castShadow
      >
        <boxGeometry args={[0.08, 2.1, couloirW * 0.95]} />
        <meshStandardMaterial color="#9fb4c4" roughness={0.5} metalness={0.15} />
      </mesh>

      {/* BUREAU TRUST — à DROITE en entrant dans le couloir, ~9 m². */}
      <group>
        {cloison(
          [x0 + couloirL / 2, hauteur / 2, zMur - 0.1],
          [largeurTrust, hauteur, 0.2],
          "trust-fond",
        )}
        <mesh
          position={[x0 + couloirL / 2, 0.14, zMur - profondeurBureau / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[largeurTrust, profondeurBureau]} />
          <meshStandardMaterial color="#c3d4ea" roughness={1} />
        </mesh>
        <Html position={[x0 + couloirL / 2, 4.2, zMur - 1.6]} center zIndexRange={[15, 0]}>
          <div className="pointer-events-none select-none whitespace-nowrap rounded border border-sky-300/30 bg-slate-900/85 px-2 py-0.5 text-center shadow">
            <div className="text-[11px] font-semibold text-sky-100">Trust Industrie</div>
            <div className="text-[9px] text-sky-200/70">~9 m² · bons de livraison</div>
          </div>
        </Html>
      </group>

      {/* BUREAU MOBILIER MALIN — à GAUCHE, exactement en face, ~18 m². */}
      <group>
        <mesh
          position={[
            x0 + couloirL / 2,
            0.14,
            zMur - couloirW * 2 - profondeurBureau / 2,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[largeurMM, profondeurBureau]} />
          <meshStandardMaterial color="#cfe0c6" roughness={1} />
        </mesh>
        <Html
          position={[x0 + couloirL / 2, 2.6, zMur - couloirW * 2 - 2.6]}
          center
          zIndexRange={[15, 0]}
        >
          <div className="pointer-events-none select-none whitespace-nowrap rounded border border-emerald-300/25 bg-slate-900/85 px-2 py-0.5 text-center shadow">
            <div className="text-[11px] font-semibold text-emerald-100">Mobilier Malin</div>
            <div className="text-[9px] text-emerald-200/70">~18 m²</div>
          </div>
        </Html>
      </group>

      {/* LES SANITAIRES, au fond du couloir. Un seul volume : leur
          cloisonnement n'est pas connu, et trois portes imaginaires auraient
          été une invention. */}
      <mesh
        position={[x0 + couloirL + 1.2, 0.14, zMur - couloirW]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[2.4, couloirW * 2.4]} />
        <meshStandardMaterial color="#d6d2dd" roughness={1} />
      </mesh>
      <Html position={[x0 + couloirL + 3.4, 3.4, zMur - couloirW]} center zIndexRange={[15, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded border border-white/15 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-200 shadow">
          WC · douche · évier
        </div>
      </Html>
    </group>
  );
}
