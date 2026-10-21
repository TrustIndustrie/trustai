"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html } from "@react-three/drei";
import type { Group } from "three";
import { PLAN, PLAN_MAGASINS, ROUTE, positionSurRoute } from "./geometrie";
import type { CodeDepot } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — le décor animé.
 *
 * ⚠ TOUT CE FICHIER EST DÉCORATIF. Aucun chariot, aucun ouvrier, aucun arbre
 * ne porte la moindre information métier : ils ne sont pas cliquables et ne
 * figurent dans aucun panneau. Ils servent uniquement à ce que la scène
 * respire. Les objets porteurs d'information — caisses, camions, bâtiments —
 * sont les seuls à réagir au clic.
 */

const BITUME = "#6f7378";

/** Le sol et la route d'affrètement. */
export function Sol() {
  const longueur = ROUTE.arrivee[2] - ROUTE.depart[2];
  const milieu = (ROUTE.arrivee[2] + ROUTE.depart[2]) / 2;
  // La chaussée déborde largement : les arrivages fournisseurs et les
  // tournées circulent au-delà des deux dépôts.
  const debord = 46;
  const bandes = Math.max(4, Math.floor((longueur + debord) / 4));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[320, 320]} />
        <meshStandardMaterial color="#a9b49c" roughness={1} />
      </mesh>

      {/* La route : c'est elle qui raconte l'affrètement Argenteuil → La Penne. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, milieu]} receiveShadow>
        <planeGeometry args={[ROUTE.largeur + 3.6, longueur + debord]} />
        <meshStandardMaterial color={BITUME} roughness={0.95} />
      </mesh>
      {Array.from({ length: bandes }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.03, ROUTE.depart[2] - debord / 2 + i * 4]}
        >
          <planeGeometry args={[0.22, 1.8]} />
          <meshStandardMaterial color="#d9d4c4" roughness={0.9} />
        </mesh>
      ))}

      {/* Bretelles vers les magasins. */}
      {PLAN_MAGASINS.map((m) => (
        <mesh
          key={m.nom}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[m.position[0] / 2, 0.02, m.position[2]]}
          receiveShadow
        >
          <planeGeometry args={[Math.abs(m.position[0]) + 8, 3.2]} />
          <meshStandardMaterial color={BITUME} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** Un chariot élévateur qui fait la navette dans un dépôt. DÉCORATIF. */
export function Chariot({
  depot,
  decalage,
}: {
  depot: CodeDepot;
  decalage: number;
}) {
  const g = useRef<Group>(null);
  const p = PLAN[depot];

  useFrame((state) => {
    if (!g.current) return;
    const t = state.clock.elapsedTime * 0.45 + decalage;
    const course = (p.profondeur - 10) / 2;
    // Un aller-retour continu, avec demi-tour aux extrémités.
    const z = Math.sin(t) * course;
    g.current.position.set(p.centre[0] + Math.cos(decalage) * 5, 0, p.centre[2] + z);
    g.current.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI;
  });

  return (
    <group ref={g}>
      <RoundedBox args={[0.9, 0.7, 1.4]} radius={0.1} smoothness={2} position={[0, 0.52, 0]} castShadow>
        <meshStandardMaterial color="#d8a435" roughness={0.6} metalness={0.15} />
      </RoundedBox>
      {/* Mât et fourches */}
      <mesh position={[0, 1.15, 0.72]} castShadow>
        <boxGeometry args={[0.72, 1.5, 0.1]} />
        <meshStandardMaterial color="#4a4f55" roughness={0.8} />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.22, 1.0]}>
          <boxGeometry args={[0.1, 0.06, 0.62]} />
          <meshStandardMaterial color="#5c6066" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {/* Arceau de protection */}
      <mesh position={[0, 1.42, -0.2]}>
        <boxGeometry args={[0.86, 0.06, 0.86]} />
        <meshStandardMaterial color="#4a4f55" roughness={0.8} />
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 1.05, -0.2]}>
          <boxGeometry args={[0.07, 0.8, 0.07]} />
          <meshStandardMaterial color="#4a4f55" roughness={0.8} />
        </mesh>
      ))}
      {[-0.42, 0.42].map((x) =>
        [-0.5, 0.5].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.18, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 10]} />
            <meshStandardMaterial color="#2b2f34" roughness={0.95} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Un ouvrier qui marche. DÉCORATIF. */
export function Ouvrier({
  base,
  rayon,
  decalage,
}: {
  base: [number, number, number];
  rayon: number;
  decalage: number;
}) {
  const g = useRef<Group>(null);
  const jambeG = useRef<Group>(null);
  const jambeD = useRef<Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.6 + decalage;
    if (g.current) {
      g.current.position.set(
        base[0] + Math.cos(t) * rayon,
        0,
        base[2] + Math.sin(t) * rayon,
      );
      g.current.rotation.y = -t + Math.PI / 2;
    }
    // Un balancement de jambes suffit à faire lire « quelqu'un marche ».
    const pas = Math.sin(state.clock.elapsedTime * 5 + decalage) * 0.5;
    if (jambeG.current) jambeG.current.rotation.x = pas;
    if (jambeD.current) jambeD.current.rotation.x = -pas;
  });

  return (
    <group ref={g} scale={0.52}>
      {/* Gilet haute visibilité */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.6, 4, 10]} />
        <meshStandardMaterial color="#e0c23a" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.15, 0]} castShadow>
        <sphereGeometry args={[0.26, 14, 12]} />
        <meshStandardMaterial color="#d9b48f" roughness={0.9} />
      </mesh>
      {/* Casque */}
      <mesh position={[0, 2.3, 0]} castShadow>
        <sphereGeometry args={[0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#d85b3a" roughness={0.6} />
      </mesh>
      <group ref={jambeG} position={[-0.16, 1.0, 0]}>
        <mesh position={[0, -0.45, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.6, 4, 8]} />
          <meshStandardMaterial color="#3d4a5c" roughness={0.9} />
        </mesh>
      </group>
      <group ref={jambeD} position={[0.16, 1.0, 0]}>
        <mesh position={[0, -0.45, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.6, 4, 8]} />
          <meshStandardMaterial color="#3d4a5c" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/** Les trois magasins, destinations finales. Cliquables. */
export function Magasin({
  nom,
  position,
  onClick,
}: {
  nom: string;
  position: [number, number, number];
  onClick: (nom: string) => void;
}) {
  return (
    <group
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick(nom); }}
    >
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[10, 0.1, 8]} />
        <meshStandardMaterial color="#cfc9bd" roughness={0.95} />
      </mesh>
      <RoundedBox args={[7, 3.6, 5.4]} radius={0.3} smoothness={3} position={[0, 1.9, 0]} castShadow>
        <meshStandardMaterial color="#efe9df" roughness={0.75} />
      </RoundedBox>
      {/* Vitrine */}
      <mesh position={[0, 1.5, 2.74]}>
        <boxGeometry args={[5.6, 1.9, 0.12]} />
        <meshStandardMaterial color="#8fb4cc" roughness={0.15} metalness={0.4} emissive="#8fb4cc" emissiveIntensity={0.2} />
      </mesh>
      {/* Bandeau d'enseigne */}
      <mesh position={[0, 3.3, 2.78]}>
        <boxGeometry args={[6, 0.7, 0.14]} />
        <meshStandardMaterial color="#d8562f" roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.85, 0]} castShadow>
        <boxGeometry args={[7.4, 0.3, 5.8]} />
        <meshStandardMaterial color="#5d6672" roughness={0.85} />
      </mesh>
      <Html position={[0, 5.6, 0]} center zIndexRange={[16, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded border border-white/20 bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-white shadow">
          {nom}
        </div>
      </Html>
    </group>
  );
}

/** Quelques arbres pour casser la platitude du terrain. DÉCORATIF. */
export function Vegetation() {
  const arbres = useMemo(() => {
    const liste: [number, number][] = [];
    // Positions fixes : pas de hasard, la scène doit être identique à chaque
    // ouverture.
    const semis = [
      [-42, -14], [-38, 4], [-44, 18], [42, -14], [38, 6], [44, 20],
      [-20, 0], [20, 0], [-30, -40], [30, -42], [-32, 44], [34, 46],
      [-14, 48], [14, -48], [48, 0], [-48, 34],
    ];
    for (const [x, z] of semis) liste.push([x, z]);
    return liste;
  }, []);

  return (
    <group>
      {arbres.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]} scale={0.9 + ((i * 13) % 5) / 10}>
          <mesh position={[0, 0.8, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.26, 1.6, 8]} />
            <meshStandardMaterial color="#6b5542" roughness={1} />
          </mesh>
          <mesh position={[0, 2.2, 0]} castShadow>
            <sphereGeometry args={[1.15, 12, 10]} />
            <meshStandardMaterial color="#5f7f52" roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Un repère visible du flux : des jalons le long de la route. DÉCORATIF. */
export function Balisage() {
  return (
    <group>
      {[0.12, 0.38, 0.62, 0.88].map((t) => {
        const [x, , z] = positionSurRoute(t);
        return (
          <group key={t}>
            {[-1, 1].map((c) => (
              <mesh key={c} position={[x + c * (ROUTE.largeur / 2 + 0.5), 0.5, z]} castShadow>
                <cylinderGeometry args={[0.08, 0.08, 1, 6]} />
                <meshStandardMaterial color="#e8e4dc" roughness={0.8} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}
